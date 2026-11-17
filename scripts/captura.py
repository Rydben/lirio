"""Captura de verificación de la ventana de Lirio (sin traerla al frente): python scripts/captura.py salida.png
Usa PrintWindow con PW_RENDERFULLCONTENT, que también captura el contenido de WebView2."""
import ctypes
import sys
from ctypes import wintypes

from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()


def find_window(title: str = "Lirio", pid: int | None = None) -> int:
    """Con pid: la ventana visible de ESE proceso (así no se confunde con otro Lirio abierto)."""
    if pid is None:
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            raise SystemExit(f"No encuentro la ventana «{title}»")
        return hwnd
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        buf = ctypes.create_unicode_buffer(64)
        user32.GetWindowTextW(hwnd, buf, 64)
        if owner.value == pid and user32.IsWindowVisible(hwnd) and buf.value == title:
            found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    if not found:
        raise SystemExit(f"No encuentro la ventana del proceso {pid}")
    return found[0]


def capture(hwnd: int) -> Image.Image:
    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    w, h = rect.right - rect.left, rect.bottom - rect.top
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    user32.PrintWindow(hwnd, mem, 2)  # PW_RENDERFULLCONTENT

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

    bi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    return Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB")


if __name__ == "__main__":
    pid = int(sys.argv[2]) if len(sys.argv) > 2 else None
    capture(find_window(pid=pid)).save(sys.argv[1] if len(sys.argv) > 1 else "lirio.png")
