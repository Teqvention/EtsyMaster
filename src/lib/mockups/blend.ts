import { BlendModeFilter, ExtensionType, extensions } from "pixi.js"

// Pixi's own advanced blend modes mix the premultiplied layer colour, which
// darkens soft edges, and its soft light is the Pegtop variant. These follow
// mockup_bauen.py `misch` (W3C formulas, as psd-tools composites) on
// straight colour, with the layer's alpha × opacity as the mix amount.
// They register under Pixi's names, so pixi.js/advanced-blend-modes must
// not be imported as well. Multiply, screen and add are exact as GL blend
// states and need nothing here.

function blendFilter(name: string, glsl: string, wgsl: string) {
  class Blend extends BlendModeFilter {
    static extension = { name, type: ExtensionType.BlendMode }
    constructor() {
      super({
        gl: {
          functions: `
            ${glsl}
            vec3 straight(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
          `,
          main: `
            vec3 b = straight(back);
            vec3 mixed = mix(b, blend(b, straight(front)), front.a);
            finalColor = vec4(mixed * blendedAlpha, blendedAlpha) * uBlend;
          `,
        },
        gpu: {
          functions: `
            ${wgsl}
            fn straight(c: vec4<f32>) -> vec3<f32> { return select(vec3<f32>(0.0), c.rgb / c.a, c.a > 0.0); }
          `,
          main: `
            let b = straight(back);
            let mixed = mix(b, blend(b, straight(front)), front.a);
            out = vec4<f32>(mixed * blendedAlpha, blendedAlpha) * blendUniforms.uBlend;
          `,
        },
      })
    }
  }
  return Blend
}

const Overlay = blendFilter(
  "overlay",
  `vec3 blend(vec3 u, vec3 o) {
    return mix(1.0 - 2.0 * (1.0 - u) * (1.0 - o), 2.0 * u * o, vec3(lessThan(u, vec3(128.0 / 255.0))));
  }`,
  `fn blend(u: vec3<f32>, o: vec3<f32>) -> vec3<f32> {
    return select(1.0 - 2.0 * (1.0 - u) * (1.0 - o), 2.0 * u * o, u < vec3<f32>(128.0 / 255.0));
  }`
)

const SoftLight = blendFilter(
  "soft-light",
  `vec3 blend(vec3 u, vec3 o) {
    vec3 d = mix(sqrt(u), ((16.0 * u - 12.0) * u + 4.0) * u, vec3(lessThanEqual(u, vec3(0.25))));
    return mix(u + (2.0 * o - 1.0) * (d - u), u - (1.0 - 2.0 * o) * u * (1.0 - u), vec3(lessThanEqual(o, vec3(0.5))));
  }`,
  `fn blend(u: vec3<f32>, o: vec3<f32>) -> vec3<f32> {
    let d = select(sqrt(u), ((16.0 * u - 12.0) * u + 4.0) * u, u <= vec3<f32>(0.25));
    return select(u + (2.0 * o - 1.0) * (d - u), u - (1.0 - 2.0 * o) * u * (1.0 - u), o <= vec3<f32>(0.5));
  }`
)

const LinearBurn = blendFilter(
  "linear-burn",
  `vec3 blend(vec3 u, vec3 o) { return max(vec3(0.0), u + o - 1.0); }`,
  `fn blend(u: vec3<f32>, o: vec3<f32>) -> vec3<f32> { return max(vec3<f32>(0.0), u + o - 1.0); }`
)

export function registerBlendModes() {
  extensions.add(Overlay, SoftLight, LinearBurn)
}

