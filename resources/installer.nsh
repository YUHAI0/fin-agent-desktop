!macro customInit
  ; Label for retry loop
  checkLoop:
  
  ; Check if the application executable exists in the installation directory
  ; $INSTDIR is initialized to the detected previous installation path or default path
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 notRunning
  
  ; Try to open the main executable for writing (append mode)
  ; This will fail if the file is locked (program is running) or if we lack permissions
  ; Since we are installing, we need write permissions anyway, so this check covers both
  ClearErrors
  FileOpen $R0 "$INSTDIR\${PRODUCT_FILENAME}.exe" a
  IfErrors isRunning 0
  
  ; If open succeeded, close it immediately and proceed
  FileClose $R0
  Goto notRunning
  
  isRunning:
  ; The file is locked or not writable. Assuming it's running.
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON1 "${PRODUCT_NAME} 正在运行。$\n$\n是否自动关闭程序并继续安装？" IDYES closeProc IDNO cancelInstall

  closeProc:
    ; Attempt to kill the process without showing a window
    nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
    Pop $0 ; Clean up the stack
    ; Wait a bit for OS to release the file lock
    Sleep 1000
    ; Re-check
    Goto checkLoop
  
  cancelInstall:
  Abort
  
  notRunning:
!macroend
