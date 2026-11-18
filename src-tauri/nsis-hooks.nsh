; Ganchos del instalador NSIS de Lirio.
; Si el instalador se abre dos veces (doble clic, o SmartScreen relanzándolo), solo el primero instala.
!macro NSIS_HOOK_PREINSTALL
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "LirioInstalador") p .r1 ?e'
  Pop $R0
  StrCmp $R0 183 0 +3
    MessageBox MB_OK|MB_ICONINFORMATION "El instalador de Lirio ya está abierto en otra ventana. Esta se cierra."
    Quit
!macroend
