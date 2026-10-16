"""Read process names and creation identity without optional dependencies."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path


def process_identity(pid):
    if os.name != 'nt':
        return str((Path('/proc') / str(pid) / 'exe').resolve(strict=True)), (Path('/proc') / str(pid) / 'stat').read_text().split()[21]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        raise OSError('Process is unavailable.')
    try:
        image, length = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
        created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel.QueryFullProcessImageNameW(handle, 0, image, ctypes.byref(length)) or not kernel.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(system), ctypes.byref(user)):
            raise OSError('Process identity is unavailable.')
        return image.value, created.dwLowDateTime | (created.dwHighDateTime << 32)
    finally:
        kernel.CloseHandle(handle)


def process_names():
    if os.name != 'nt':
        names = []
        for path in Path('/proc').glob('[0-9]*/comm'):
            try:
                names.append(path.read_text().strip())
            except OSError:
                pass
        return names
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class Entry(ctypes.Structure):
        _fields_ = [('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
                    ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
                    ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
                    ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260)]
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    handle = kernel.CreateToolhelp32Snapshot(2, 0)
    if handle == ctypes.c_void_p(-1).value:
        raise OSError('Process list is unavailable.')
    try:
        item = Entry()
        item.dwSize = ctypes.sizeof(item)
        names = []
        valid = kernel.Process32FirstW(handle, ctypes.byref(item))
        while valid:
            names.append(item.szExeFile)
            valid = kernel.Process32NextW(handle, ctypes.byref(item))
        return names
    finally:
        kernel.CloseHandle(handle)
