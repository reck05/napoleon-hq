' Napoleon HQ: starts the local server if it is not running, then opens the app in its own window.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

Function IsUp()
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 400, 400, 400, 400
  http.open "GET", "http://127.0.0.1:4517/api/health", False
  http.send
  IsUp = (Err.Number = 0 And http.status = 200)
End Function

If Not IsUp() Then
  sh.Run "cmd /c node """ & dir & "\server.mjs""", 0, False
  For i = 1 To 40
    WScript.Sleep 150
    If IsUp() Then Exit For
  Next
End If

edge = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
sh.Run """" & edge & """ --app=http://localhost:4517 --window-size=1440,900", 1, False
