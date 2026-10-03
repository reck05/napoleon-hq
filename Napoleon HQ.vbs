' Napoleon HQ: opens authenticated local access without putting its key in this launcher.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
cli = "node """ & dir & "\scripts\mobile-setup.mjs"""
If sh.Run(cli & " open", 0, True) <> 0 Then
  sh.Run cli & " start", 0, False
  If sh.Run(cli & " open", 0, True) <> 0 Then
    MsgBox "Napoleon no pudo iniciarse. Abre scripts\Preparar Napoleon.cmd para completar la preparación.", 48, "Napoleon HQ"
  End If
End If
