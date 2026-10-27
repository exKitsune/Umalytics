"""Local change notifications; counters contain no race or trainer data."""
import threading
import os


class AnalysisEvents:
    def __init__(self):
        self.condition = threading.Condition()
        self.revision = self.library = self.analysis = 0

    def publish(self, kind):
        with self.condition:
            self.revision += 1
            if kind == 'library':
                self.library += 1
            else:
                self.analysis += 1
            self.condition.notify_all()

    def wait(self, after, timeout=20):
        if type(after) is not int or not 0 <= after <= 2**53:
            raise ValueError('Invalid event revision.')
        with self.condition:
            self.condition.wait_for(lambda: self.revision != after, timeout)
            return dict(revision=self.revision, library=self.library, analysis=self.analysis)


def watch_directory(path, closed, changed):
    """Use Windows filesystem notifications; polling is a portable fallback."""
    def fallback():
        previous = None
        while not closed.wait(.5):
            try:
                stamp = tuple(sorted((p.name, p.stat().st_mtime_ns, p.stat().st_size)
                                     for p in path.glob('*.json') if not p.is_symlink()))
            except OSError:
                continue
            if previous is not None and stamp != previous:
                changed()
            previous = stamp

    def watch():
        if os.name != 'nt':
            fallback()
            return
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.FindFirstChangeNotificationW.argtypes = [wintypes.LPCWSTR, wintypes.BOOL, wintypes.DWORD]
        kernel.FindFirstChangeNotificationW.restype = wintypes.HANDLE
        kernel.FindNextChangeNotification.argtypes = [wintypes.HANDLE]
        kernel.FindNextChangeNotification.restype = wintypes.BOOL
        kernel.FindCloseChangeNotification.argtypes = [wintypes.HANDLE]
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        handle = kernel.FindFirstChangeNotificationW(str(path), False, 0x1 | 0x8 | 0x10)
        if handle == ctypes.c_void_p(-1).value:
            fallback()
            return
        try:
            while not closed.is_set():
                result = kernel.WaitForSingleObject(handle, 500)
                if result == 0:
                    if not kernel.FindNextChangeNotification(handle):
                        break
                    changed()
                elif result != 258:  # WAIT_TIMEOUT
                    break
        finally:
            kernel.FindCloseChangeNotification(handle)
        if not closed.is_set():
            fallback()

    thread = threading.Thread(target=watch, name='race-library-events', daemon=True)
    thread.start()
    return thread
