// pdfjs-dist (used internally by pdf-parse) unconditionally constructs a
// DOMMatrix at module load time, purely to support page *rendering*. We only
// ever extract text (never render a page), so a real implementation isn't
// needed — but without at least a stub, the whole server crashes on import,
// on any platform where the optional native @napi-rs/canvas binding doesn't
// load (a common issue: see e.g. github.com/mozilla/pdf.js/issues/19764).
// Importing this file before "pdf-parse" avoids pdfjs-dist ever needing that
// native dependency at all.
if (typeof globalThis.DOMMatrix === "undefined") {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    invertSelf() { return this; }
    transformPoint(point) { return point; }
  };
}

if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(width, height) { this.width = width; this.height = height; this.data = new Uint8ClampedArray(width * height * 4); }
  };
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    moveTo() {} lineTo() {} closePath() {} rect() {} arc() {}
  };
}
