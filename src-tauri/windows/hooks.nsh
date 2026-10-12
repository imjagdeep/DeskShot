; Installer hooks (Tauri NSIS). After installing or updating, make Windows
; drop its cached icons so the taskbar, Start menu, desktop shortcut and
; pinned shortcuts show the new icon straight away. (-show alone wasn't
; enough on Windows 11: the old icon stayed until the cache was cleared.)
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$SYSDIR\ie4uinit.exe" -ClearIconCache'
  ExecWait '"$SYSDIR\ie4uinit.exe" -show'
  ; SHCNE_ASSOCCHANGED with SHCNF_FLUSH: the shell rebuilds its icon lists now.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

; Before removing DeskShot: if it took the Print Screen key from the
; Snipping Tool, hand it back (the app knows whether it did).
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\deskshot.exe" --release-print-screen'
!macroend
