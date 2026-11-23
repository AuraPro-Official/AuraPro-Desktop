!macro customUnInit
  # The one-click template switches to silent mode after its confirmation
  # dialog. Restore the built-in progress page only for interactive uninstalls.
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  ${if} ${Errors}
    SetSilent normal
  ${endif}
  ClearErrors
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetDetailsPrint textonly
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ${if} ${FileExists} "$APPDATA\AuraPro\certs\*.*"
      DetailPrint "Removing the AuraPro local HTTPS certificate..."
      InitPluginsDir
      File /oname=$PLUGINSDIR\remove-local-certificate.ps1 "${BUILD_RESOURCES_DIR}\remove-local-certificate.ps1"
      nsExec::ExecToLog /TIMEOUT=15000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\remove-local-certificate.ps1" -CertDirectory "$APPDATA\AuraPro\certs"'
      Pop $R0
      ${if} $R0 != "0"
        DetailPrint "Certificate cleanup failed. If still present, remove it from the current user's certificate store."
        ${ifNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "The AuraPro local HTTPS certificate could not be removed. The certificate may still be in your current user's trusted certificate store."
        ${endif}
      ${endif}
    ${endif}
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
    DetailPrint "Removing AI models and runtime files. This may take several minutes..."
    RMDir /r "$APPDATA\AuraPro\models"
    RMDir /r "$APPDATA\AuraPro\python"
    RMDir /r "$APPDATA\AuraPro\llama.cpp"
    RMDir /r "$APPDATA\AuraPro\sherpa"
    RMDir /r "$APPDATA\AuraPro\data"

    DetailPrint "Removing AuraPro application data..."
    RMDir /r "$APPDATA\AuraPro"

    DetailPrint "Removing AuraPro cache files..."
    RMDir /r "$LOCALAPPDATA\AuraPro"

    DetailPrint "Removing legacy AuraPro settings..."
    RMDir /r "$APPDATA\com.aurapro.desktop"
    RMDir /r "$LOCALAPPDATA\com.aurapro.desktop"

    DetailPrint "Finishing uninstall..."
    SetDetailsPrint lastused
  ${endif}
!macroend
