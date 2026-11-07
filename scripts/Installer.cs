using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

class Installer : Form {
  TextBox destination = new TextBox();
  Button install = new Button();
  Label status = new Label();
  CheckBox launch = new CheckBox();
  public Installer() {
    Text = "Reminiscence · Setup"; ClientSize = new Size(550, 305); FormBorderStyle = FormBorderStyle.FixedDialog;
    MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(247,245,239);
    Font = new Font("Palatino Linotype", 10);
    Controls.Add(new Label { Text="Reminiscence", Font=new Font("Palatino Linotype",25), Location=new Point(28,23), Size=new Size(490,45) });
    Controls.Add(new Label { Text="An ecological notebook across time.", ForeColor=Color.DimGray, Location=new Point(31,75), Size=new Size(480,25) });
    Controls.Add(new Label { Text="Install on this computer", Location=new Point(31,120), Size=new Size(460,23) });
    destination.SetBounds(31,148,485,28);destination.Text=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","Reminiscence");Controls.Add(destination);
    launch.Text="Open Reminiscence after installation";launch.Checked=true;launch.SetBounds(31,188,455,28);Controls.Add(launch);
    status.SetBounds(31,245,335,35);Controls.Add(status);
    install.Text="Install";install.SetBounds(390,239,126,35);install.BackColor=Color.FromArgb(64,91,72);install.ForeColor=Color.White;install.FlatStyle=FlatStyle.Flat;install.Click+=Run;Controls.Add(install);
  }
  void Run(object sender, EventArgs args) {
    install.Enabled=false;destination.Enabled=false;
    try {
      string target=Path.GetFullPath(destination.Text);Directory.CreateDirectory(target);
      string exe=Path.Combine(target,"Reminiscence.exe");
      foreach (Process running in Process.GetProcessesByName("Reminiscence")) {
        try {if(String.Equals(running.MainModule.FileName,exe,StringComparison.OrdinalIgnoreCase))throw new IOException("Close Reminiscence before updating this installation.");}catch(System.ComponentModel.Win32Exception){}
      }
      status.Text="Unpacking the notebook…";Application.DoEvents();
      using(Stream payload=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
      using(ZipArchive archive=new ZipArchive(payload,ZipArchiveMode.Read)) {
        foreach(ZipArchiveEntry entry in archive.Entries) {
          string file=Path.GetFullPath(Path.Combine(target,entry.FullName));
          if(!file.StartsWith(target+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Invalid package path.");
          if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(file);continue;}
          Directory.CreateDirectory(Path.GetDirectoryName(file));entry.ExtractToFile(file,true);
        }
      }
      string programs=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Reminiscence");Directory.CreateDirectory(programs);
      Shortcut(Path.Combine(programs,"Reminiscence.lnk"),exe,target);
      Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"Reminiscence.lnk"),exe,target);
      status.Text="Installed. Your field awaits.";install.Text="Close";
      if(launch.Checked)Process.Start(exe);
      install.Click-=Run;install.Click+=(s,e)=>Close();install.Enabled=true;
    }catch(Exception error){MessageBox.Show(this,error.Message,"Installation could not finish",MessageBoxButtons.OK,MessageBoxIcon.Error);install.Enabled=true;destination.Enabled=true;status.Text="Please try again.";}
  }
  static void Shortcut(string file,string target,string folder) {
    Type shell=Type.GetTypeFromProgID("WScript.Shell");object obj=Activator.CreateInstance(shell);
    object shortcut=shell.InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,obj,new object[]{file});
    Type t=shortcut.GetType();t.InvokeMember("TargetPath",BindingFlags.SetProperty,null,shortcut,new object[]{target});t.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,shortcut,new object[]{folder});t.InvokeMember("Save",BindingFlags.InvokeMethod,null,shortcut,null);
  }
  [STAThread] static void Main() {Application.EnableVisualStyles();Application.Run(new Installer());}
}
