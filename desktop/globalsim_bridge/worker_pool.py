"""Bounded reusable transport for pinned, stateless GlobalSim JSONL workers.

One request at a time per pool. A timeout, malformed reply, changed executable
or output limit retires the process; the failed request is never silently retried.
"""
import os
import queue
import struct
import subprocess
import tempfile
import threading
import time
import math


class WorkerPool:
    def __init__(self):
        self.lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.session = None
        self.closed = False

    def run(self, config, payload):
        from .runtime import _WorkerFailure, _file_digest, _strict_json
        if len(payload) > config.max_input_bytes:
            raise _WorkerFailure('INPUT_LIMIT', 'Prepared engine request exceeds the configured byte limit')
        if not config.expected_engine_sha256:
            raise _WorkerFailure('ENGINE_PIN_MISMATCH', 'Reusable workers require a matching executable pin')
        stat = config.engine_path.stat()
        key = (str(config.engine_path), stat.st_dev, stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size,
               config.expected_engine_sha256, config.engine_args, config.worker_protocol,
               config.max_output_bytes, config.max_stderr_bytes, str(config.work_root), config.low_priority)
        with self.lock:
            started = time.monotonic()
            try:
                with self.state_lock:
                    if self.closed:
                        raise _WorkerFailure('ENGINE_CLOSED', 'Simulator service is shutting down')
                    if self.session is None or self.session.key != key or self.session.process.poll() is not None:
                        if self.session:
                            self.session.close()
                            self.session = None
                        # Authenticate before launching a process, then check
                        # file identity on every request. An unchanged live
                        # process runs the already-verified executable image.
                        # Any replacement/change or restart must hash again.
                        if _file_digest(config.engine_path) != config.expected_engine_sha256:
                            raise _WorkerFailure('ENGINE_PIN_MISMATCH', 'Reusable workers require a matching executable pin')
                        self.session = _Session(config, key)
                    session = self.session
                session.requests.put_nowait(payload)
                deadline = started + config.timeout_seconds
                while True:
                    if config.cancel_event is not None and config.cancel_event.is_set():
                        raise _WorkerFailure('CANCELLED', 'Analysis was interrupted')
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise _WorkerFailure('TIMEOUT', 'Simulator exceeded its configured time limit')
                    try:
                        response = session.replies.get(timeout=min(.05, remaining))
                        break
                    except queue.Empty:
                        continue
                if isinstance(response, Exception):
                    raise response
                metadata, frames = response
                modeled = _strict_json(metadata)
                if not isinstance(modeled, dict):
                    raise ValueError('Simulator reply is not an object')
                if frames is not None and config.retain_binary_frames:
                    if 'frames' in modeled or '_binary_frames' in modeled:
                        raise ValueError('Duplicate binary frames')
                    modeled['_binary_frames'] = frames
                elif frames is not None and config.decode_frames:
                    count, horses, raw = frames
                    if 'frames' in modeled:
                        raise ValueError('Duplicate binary frames')
                    fields = ('pos', 'speed', 'hp', 'lane', 'temptationMode', 'blockFrontHorseIndex')
                    rows, offset = [], 0
                    for _ in range(count):
                        timestamp, = struct.unpack_from('<d', raw, offset); offset += 8
                        runners = []
                        for _ in range(horses):
                            values = struct.unpack_from('<6d', raw, offset); offset += 48
                            if not all(math.isfinite(v) for v in values):
                                raise ValueError('Non-finite binary frame')
                            runners.append(dict(zip(fields, values)))
                        if not math.isfinite(timestamp):
                            raise ValueError('Non-finite binary timestamp')
                        rows.append({'t': timestamp, 'horses': runners})
                    if count:
                        modeled['frames'] = rows
                if session.failure:
                    raise session.failure
                return modeled, time.monotonic() - started, session.errors.decode('utf-8', errors='replace')
            except Exception as error:
                with self.state_lock:
                    if self.session:
                        self.session.close()
                        self.session = None
                if isinstance(error, _WorkerFailure):
                    raise
                raise _WorkerFailure('INVALID_OUTPUT', 'Reusable simulator protocol failed', {'reason': str(error)}) from error

    def set_background(self, background):
        # Promote only this pool's owned process; never change another service.
        with self.state_lock:
            if self.session and self.session.process.poll() is None:
                process = self.session.process
                if os.name == 'nt':
                    import ctypes
                    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
                    kernel.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
                    kernel.SetPriorityClass.restype = ctypes.c_int
                    kernel.SetPriorityClass(int(process._handle), 0x4000 if background else 0x20)
                elif hasattr(os, 'setpriority'):
                    try:
                        os.setpriority(os.PRIO_PROCESS, process.pid, 10 if background else 0)
                    except OSError:
                        pass

    def close(self):
        # Do not wait for a currently running request's lock or timeout.
        with self.state_lock:
            self.closed = True
            if self.session:
                self.session.close()
                self.session = None


class _Session:
    def __init__(self, config, key):
        self.key, self.config = key, config
        self.failure = None
        self.requests, self.replies = queue.Queue(maxsize=1), queue.Queue(maxsize=2)
        self.errors = bytearray()
        if config.work_root:
            config.work_root.mkdir(parents=True, exist_ok=True)
        self.folder = tempfile.TemporaryDirectory(prefix='globalsim-session-', dir=config.work_root)
        env = {k: v for k, v in os.environ.items() if not k.startswith('GLOBALSIM_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env['GLOBALSIM_OUTPUT'] = config.worker_protocol
        flags = {'start_new_session': True} if os.name == 'posix' else {'creationflags': subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
        if os.name == 'nt' and config.low_priority:
            flags['creationflags'] |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
        try:
            self.process = subprocess.Popen([str(config.engine_path), *config.engine_args], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=self.folder.name, env=env, shell=False, **flags)
        except Exception:
            self.folder.cleanup()
            raise
        for target in (self.write, self.read, self.read_errors):
            threading.Thread(target=target, daemon=True).start()

    def fail(self, error):
        if self.failure is None:
            self.failure = error
        try:
            self.replies.put_nowait(error)
        except queue.Full:
            pass
        if self.process.poll() is None:
            self.process.kill()

    def write(self):
        try:
            while True:
                payload = self.requests.get()
                if payload is None:
                    return
                self.process.stdin.write(payload)
                self.process.stdin.flush()
        except (OSError, ValueError) as error:
            self.fail(error)

    def exact(self, size):
        output = bytearray()
        while len(output) < size:
            chunk = self.process.stdout.read(size - len(output))
            if not chunk:
                raise ValueError('Incomplete simulator response')
            output.extend(chunk)
        return output

    def read(self):
        from .runtime import _WorkerFailure
        try:
            while True:
                if self.config.worker_protocol == 'binary-v1':
                    header = self.exact(32)
                    magic, size, count, horses, frame_bytes = struct.unpack('<8sQIIQ', header)
                    if magic != b'GSIMRP01' or horses > 64 or frame_bytes != count * (8 + horses * 48):
                        raise ValueError('Invalid binary frame header')
                    if 32 + size + frame_bytes > self.config.max_output_bytes:
                        raise _WorkerFailure('OUTPUT_LIMIT', 'Simulator exceeded its configured output limit')
                    response = (self.exact(size), (count, horses, self.exact(frame_bytes)))
                else:
                    line = self.process.stdout.readline(self.config.max_output_bytes + 1)
                    if len(line) > self.config.max_output_bytes:
                        raise _WorkerFailure('OUTPUT_LIMIT', 'Simulator exceeded its configured output limit')
                    if not line.endswith(b'\n'):
                        raise ValueError('Incomplete simulator response')
                    response = (line, None)
                self.replies.put_nowait(response)
        except (OSError, ValueError, queue.Full, _WorkerFailure) as error:
            self.fail(error)

    def read_errors(self):
        from .runtime import _WorkerFailure
        try:
            while True:
                raw = self.process.stderr.read1(4096)
                if not raw:
                    return
                remaining = self.config.max_stderr_bytes - len(self.errors)
                self.errors.extend(raw[:remaining])
                if len(raw) > remaining:
                    self.fail(_WorkerFailure('OUTPUT_LIMIT', 'Simulator exceeded its stderr limit'))
                    return
        except (OSError, ValueError):
            pass

    def close(self):
        from .runtime import _kill_worker
        _kill_worker(self.process)
        try:
            self.requests.put_nowait(None)
        except queue.Full:
            pass
        for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
            try:
                pipe.close()
            except OSError:
                pass
        self.folder.cleanup()
