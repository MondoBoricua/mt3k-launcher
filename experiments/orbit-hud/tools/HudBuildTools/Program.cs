using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Xml.Linq;
using OrbitHud.Core;

if (args.Length == 1 && args[0] == "test")
{
    var epoch = DateTimeOffset.Parse("2026-09-07T12:00:00Z");
    var timer = new SessionTimer();
    Check(!timer.IsRunning && timer.Elapsed(epoch) == TimeSpan.Zero, "Fresh timer is stopped");
    timer.Toggle(epoch);
    Check(timer.Elapsed(epoch.AddMinutes(5)) == TimeSpan.FromMinutes(5), "Hidden UI does not stop elapsed time");
    timer.Toggle(epoch.AddMinutes(5));
    Check(!timer.IsRunning && timer.Elapsed(epoch.AddHours(2)) == TimeSpan.FromMinutes(5), "Pause freezes elapsed time");
    timer.Toggle(epoch.AddHours(2));
    var restored = new SessionTimer(timer.Accumulated, timer.StartedAt);
    Check(restored.Elapsed(epoch.AddHours(3)) == TimeSpan.FromMinutes(65), "Restart restores an active timer");
    Check(restored.Elapsed(epoch) == TimeSpan.FromMinutes(5), "Clock rollback never subtracts elapsed time");
    restored.Reset();
    Check(!restored.IsRunning && restored.Elapsed(epoch) == TimeSpan.Zero, "Reset stops and clears timer");
    Check(SessionTimer.Format(TimeSpan.FromHours(27) + TimeSpan.FromSeconds(9)) == "27:00:09", "Long sessions do not wrap at midnight");
    Check(new SessionTimer(TimeSpan.FromSeconds(-10)).Elapsed(epoch) == TimeSpan.Zero, "Invalid negative saved time is clamped");
    Console.WriteLine("8 timer checks passed.");
    return;
}
if (args.Length != 4 || args[0] != "manifest")
    throw new ArgumentException("Use: test | manifest <template> <SDK folder> <output>");

XNamespace ns = "http://schemas.microsoft.com/appx/manifest/foundation/windows10";
var doc = XDocument.Load(args[1]);
var extensions = new XElement(ns + "Extensions");
var inProcess = new XElement(ns + "InProcessServer", new XElement(ns + "Path", "Microsoft.Gaming.XboxGameBar.dll"));
var proxy = new XElement(ns + "ProxyStub", new XAttribute("ClassId", "00000355-0000-0000-C000-000000000046"),
    new XElement(ns + "Path", "Microsoft.Gaming.XboxGameBar.winmd"));
ReadMetadata(Path.Combine(args[2], "lib", "uap10.0", "Microsoft.Gaming.XboxGameBar.winmd"), false);
ReadMetadata(Path.Combine(args[2], "private", "Microsoft.Gaming.XboxGameBar.Private.winmd"), true);
extensions.Add(new XElement(ns + "Extension", new XAttribute("Category", "windows.activatableClass.inProcessServer"), inProcess));
extensions.Add(new XElement(ns + "Extension", new XAttribute("Category", "windows.activatableClass.proxyStub"), proxy));
doc.Root!.Add(extensions);
doc.Save(args[3]);
Console.WriteLine($"Manifest: {inProcess.Elements(ns + "ActivatableClass").Count()} runtime classes, {proxy.Elements(ns + "Interface").Count()} private marshaling interfaces.");

void ReadMetadata(string path, bool privateTypes)
{
    using var stream = File.OpenRead(path);
    using var pe = new PEReader(stream);
    var reader = pe.GetMetadataReader();
    foreach (var handle in reader.TypeDefinitions)
    {
        var type = reader.GetTypeDefinition(handle);
        var name = reader.GetString(type.Namespace) + "." + reader.GetString(type.Name);
        var activatable = false;
        Guid? guid = null;
        foreach (var attrHandle in type.GetCustomAttributes())
        {
            var attribute = reader.GetCustomAttribute(attrHandle);
            if (attribute.Constructor.Kind != HandleKind.MemberReference) continue;
            var constructor = reader.GetMemberReference((MemberReferenceHandle)attribute.Constructor);
            if (constructor.Parent.Kind != HandleKind.TypeReference) continue;
            var attrType = reader.GetTypeReference((TypeReferenceHandle)constructor.Parent);
            var attrName = reader.GetString(attrType.Name);
            activatable |= attrName is "ActivatableAttribute" or "StaticAttribute";
            if (attrName == "GuidAttribute")
            {
                var blob = reader.GetBlobReader(attribute.Value);
                if (blob.ReadUInt16() != 1) throw new InvalidDataException("Invalid GUID attribute.");
                guid = new Guid(blob.ReadInt32(), blob.ReadInt16(), blob.ReadInt16(), blob.ReadBytes(8));
            }
        }
        if (!privateTypes && activatable)
            inProcess.Add(new XElement(ns + "ActivatableClass", new XAttribute("ActivatableClassId", name), new XAttribute("ThreadingModel", "both")));
        if (privateTypes && guid.HasValue)
            proxy.Add(new XElement(ns + "Interface", new XAttribute("Name", name), new XAttribute("InterfaceId", guid.Value.ToString().ToUpperInvariant())));
    }
}

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
    Console.WriteLine("PASS " + message);
}
