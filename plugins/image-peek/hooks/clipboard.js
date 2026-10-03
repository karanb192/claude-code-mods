ObjC.import('AppKit');
ObjC.import('Foundation');

function run(args) {
  var action = args[0];
  var session = args[1];
  if (!/^[a-f0-9-]{36}$/i.test(session || '')) throw new Error('Invalid session');
  var fm = $.NSFileManager.defaultManager;
  var root = ObjC.unwrap($.NSTemporaryDirectory()) + 'claude-image-peek/';
  var directory = root + session;
  if (action === 'cleanup') {
    fm.removeItemAtPathError($(directory), null);
    return JSON.stringify({ ok: true });
  }
  if (action !== 'capture') throw new Error('Invalid action');
  [root, directory].forEach(function (path) {
    var existing = fm.attributesOfItemAtPathError($(path), null);
    if (existing && !existing.isNil() && ObjC.unwrap(existing.objectForKey($.NSFileType)) !== 'NSFileTypeDirectory') {
      throw new Error('Preview cache must be a directory');
    }
  });
  var board = $.NSPasteboard.generalPasteboard;
  var version = board.changeCount;
  var data = board.dataForType($.NSPasteboardTypePNG);
  if (!data || data.isNil()) data = board.dataForType($.NSPasteboardTypeTIFF);
  if (!data || data.isNil()) return JSON.stringify({ ok: false });
  if (Number(data.length) > 33554432) return JSON.stringify({ ok: false });
  var bitmap = $.NSBitmapImageRep.imageRepWithData(data);
  if (!bitmap || bitmap.isNil()) return JSON.stringify({ ok: false });
  var width = Number(bitmap.pixelsWide);
  var height = Number(bitmap.pixelsHigh);
  if (width < 1 || height < 1 || width * height > 64000000) return JSON.stringify({ ok: false });
  var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  if (!png || png.isNil() || Number(png.length) > 33554432) return JSON.stringify({ ok: false });
  var attributes = $({ NSFilePosixPermissions: 448 });
  if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(directory), true, attributes, null)) {
    throw new Error('Cannot create preview cache');
  }
  var path = directory + '/' + ObjC.unwrap($.NSUUID.UUID.UUIDString) + '.png';
  if (!png.writeToFileAtomically($(path), true)) throw new Error('Cannot save preview');
  fm.setAttributesOfItemAtPathError($({ NSFilePosixPermissions: 384 }), $(path), null);
  if (board.changeCount !== version) {
    fm.removeItemAtPathError($(path), null);
    return JSON.stringify({ ok: false });
  }
  var names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(directory), null)) || [];
  var files = names.filter(function (name) { return /^[A-F0-9-]{36}\.png$/i.test(name); });
  files.sort(function (a, b) {
    function created(name) {
      return Number(fm.attributesOfItemAtPathError($(directory + '/' + name), null).objectForKey($.NSFileCreationDate).timeIntervalSince1970);
    }
    return created(a) - created(b);
  });
  files.slice(0, Math.max(0, files.length - 24)).forEach(function (name) {
    fm.removeItemAtPathError($(directory + '/' + name), null);
  });
  return JSON.stringify({ ok: true, path: path, width: width, height: height });
}
