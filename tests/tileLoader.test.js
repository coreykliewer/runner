import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addCacheBust, getTileContext, prepareTileDefinitions } from "../src/shared/tileLoader.js";

describe("tile loader", () => {
  it("adds cache busting parameters", () => {
    assert.equal(addCacheBust("tiles2.json", 123), "tiles2.json?cb=123");
    assert.equal(addCacheBust("tiles2.json?v=1", 123), "tiles2.json?v=1&cb=123");
  });

  it("prepares base and variant images with an injected image factory", () => {
    const tiles = prepareTileDefinitions({
      P: {
        svg: "<svg></svg>",
        lock: {
          a: { svg: "<svg id='a'></svg>" }
        }
      }
    }, {
      imageFactory: svg => ({ src: svg })
    });

    assert.equal(tiles.P.img.src, "<svg></svg>");
    assert.equal(tiles.P.lock.a.img.src, "<svg id='a'></svg>");
  });

  it("builds effective tile context with variant overrides", () => {
    const context = getTileContext({
      tiles: {
        K: {
          solid: true,
          hint: "base",
          lock: {
            a: { hint: "variant" }
          }
        }
      },
      mapTiles: [["K"]],
      mapVariants: [["a"]],
      x: 0,
      y: 0
    });

    assert.equal(context.ch, "K");
    assert.equal(context.variantBucket, "lock");
    assert.equal(context.def.hint, "variant");
    assert.equal(context.def.solid, true);
  });
});
