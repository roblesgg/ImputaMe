; Cierre de imputa.me antes de instalar encima.
;
; La comprobación de serie de electron-builder mata la app con taskkill /f, espera
; unos 3 s en total y, si aún ve un proceso imputa.me.exe, saca "no se puede cerrar
; imputa.me, ciérrela y pulse Reintentar". Electron son varios procesos (principal,
; GPU, uno por ventana) y a veces tardan más que eso en desaparecer del todo, así
; que el aviso salía de vez en cuando al actualizar aunque la app ya estuviera
; saliendo. Y si ahí se pulsa Cancelar, la actualización se queda a medias.
;
; Esta versión:
;   - En una actualización (--updated) no pregunta nada: la app ya está cerrándose
;     sola (installUpdateNow en main.js guarda y sale en 4 s como mucho), así que
;     primero le da hasta 6 s para irse por las buenas.
;   - Después la cierra a la fuerza (/t: con todos sus procesos hijos) y lo repite
;     cada medio segundo, en vez de rendirse al segundo intento.
;   - Solo si tras ~20 s sigue viva pregunta, y Reintentar vuelve a forzar.
; En una instalación a mano con la app abierta pregunta como siempre antes de
; cerrarla, y a partir de ahí igual.

!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
      Quit
      ; A mano no se va a cerrar sola: se pasa directamente a forzar.
      StrCpy $R1 12
    ${else}
      StrCpy $R1 0
    ${endIf}

    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    ${Do}
      !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
      ${IfThen} $R0 != 0 ${|} ${ExitDo} ${|}
      IntOp $R1 $R1 + 1
      ${if} $R1 > 12
        !ifdef INSTALL_MODE_PER_ALL_USERS
          nsExec::Exec `taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"`
        !else
          nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
        !endif
        Pop $R0
      ${endIf}
      ${if} $R1 > 52
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY +2
        Quit
        StrCpy $R1 12
      ${endIf}
      Sleep 500
    ${Loop}

    ; Que Windows suelte los ficheros del proceso que acaba de morir antes de copiar.
    Sleep 500
  ${endIf}
!macroend
