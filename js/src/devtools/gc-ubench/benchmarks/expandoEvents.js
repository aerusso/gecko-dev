/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

tests.set(
  "expandoEvents",
  (function() {
    var garbage = [];
    var garbageIndex = 0;
    return {
      description: "var foo = [ textNode, textNode, ... ]",

      load: N => {
        garbage = new Array(N);
      },
      unload: () => {
        garbage = [];
        garbageIndex = 0;
      },

      defaultGarbagePerFrame: "100K",
      defaultGarbageTotal: "8",

      makeGarbage: N => {
        var a = [];
        for (var i = 0; i < N; i++) {
          var e = document.createEvent("Events");
          e.initEvent("TestEvent", true, true);
          e.color = ["tuna"];
          a.push(e);
        }
        garbage[garbageIndex++] = a;
        if (garbageIndex == garbage.length) {
          garbageIndex = 0;
        }
      },
    };
  })()
);
