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
