// |reftest| skip -- regexp-unicode-property-escapes is not supported
// Copyright 2020 Mathias Bynens. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
author: Mathias Bynens
description: >
  Unicode property escapes for `Script_Extensions=Duployan`
info: |
  Generated by https://github.com/mathiasbynens/unicode-property-escapes-tests
  Unicode v13.0.0
esid: sec-static-semantics-unicodematchproperty-p
features: [regexp-unicode-property-escapes]
includes: [regExpUtils.js]
---*/

const matchSymbols = buildString({
  loneCodePoints: [],
  ranges: [
    [0x01BC00, 0x01BC6A],
    [0x01BC70, 0x01BC7C],
    [0x01BC80, 0x01BC88],
    [0x01BC90, 0x01BC99],
    [0x01BC9C, 0x01BCA3]
  ]
});
testPropertyEscapes(
  /^\p{Script_Extensions=Duployan}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Duployan}"
);
testPropertyEscapes(
  /^\p{Script_Extensions=Dupl}+$/u,
  matchSymbols,
  "\\p{Script_Extensions=Dupl}"
);
testPropertyEscapes(
  /^\p{scx=Duployan}+$/u,
  matchSymbols,
  "\\p{scx=Duployan}"
);
testPropertyEscapes(
  /^\p{scx=Dupl}+$/u,
  matchSymbols,
  "\\p{scx=Dupl}"
);

const nonMatchSymbols = buildString({
  loneCodePoints: [],
  ranges: [
    [0x00DC00, 0x00DFFF],
    [0x000000, 0x00DBFF],
    [0x00E000, 0x01BBFF],
    [0x01BC6B, 0x01BC6F],
    [0x01BC7D, 0x01BC7F],
    [0x01BC89, 0x01BC8F],
    [0x01BC9A, 0x01BC9B],
    [0x01BCA4, 0x10FFFF]
  ]
});
testPropertyEscapes(
  /^\P{Script_Extensions=Duployan}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Duployan}"
);
testPropertyEscapes(
  /^\P{Script_Extensions=Dupl}+$/u,
  nonMatchSymbols,
  "\\P{Script_Extensions=Dupl}"
);
testPropertyEscapes(
  /^\P{scx=Duployan}+$/u,
  nonMatchSymbols,
  "\\P{scx=Duployan}"
);
testPropertyEscapes(
  /^\P{scx=Dupl}+$/u,
  nonMatchSymbols,
  "\\P{scx=Dupl}"
);

reportCompare(0, 0);
