// Minimal declaration of the WHATWG Encoding API, present as a global in both
// browsers and Node. Declared here so this package needs neither the DOM lib
// nor @types/node.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}
