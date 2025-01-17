/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Composite a picture cache tile into the framebuffer.

#include shared,yuv

#ifdef WR_FEATURE_YUV
flat varying mat3 vYuvColorMatrix;
flat varying float vYuvCoefficient;
flat varying int vYuvFormat;
varying vec3 vUV_y;
varying vec3 vUV_u;
varying vec3 vUV_v;
flat varying vec4 vUVBounds_y;
flat varying vec4 vUVBounds_u;
flat varying vec4 vUVBounds_v;
#else
flat varying vec4 vColor;
flat varying float vLayer;
varying vec2 vUv;
#endif

#ifdef WR_VERTEX_SHADER
// CPU side data is in CompositeInstance (gpu_types.rs) and is
// converted to GPU data using desc::COMPOSITE (renderer.rs) by
// filling vaos.composite_vao with VertexArrayKind::Composite.
PER_INSTANCE in vec4 aDeviceRect;
PER_INSTANCE in vec4 aDeviceClipRect;
PER_INSTANCE in vec4 aColor;
PER_INSTANCE in vec4 aParams;
PER_INSTANCE in vec3 aTextureLayers;

#ifdef WR_FEATURE_YUV
PER_INSTANCE in vec4 aUvRect0;
PER_INSTANCE in vec4 aUvRect1;
PER_INSTANCE in vec4 aUvRect2;
#else
PER_INSTANCE in vec4 aUvRect0;
#endif

void main(void) {
	// Get world position
    vec2 world_pos = aDeviceRect.xy + aPosition.xy * aDeviceRect.zw;

    // Clip the position to the world space clip rect
    vec2 clipped_world_pos = clamp(world_pos, aDeviceClipRect.xy, aDeviceClipRect.xy + aDeviceClipRect.zw);

    // Derive the normalized UV from the clipped vertex position
    vec2 uv = (clipped_world_pos - aDeviceRect.xy) / aDeviceRect.zw;

#ifdef WR_FEATURE_YUV
    int yuv_color_space = int(aParams.y);
    int yuv_format = int(aParams.z);
    float yuv_coefficient = aParams.w;

    vYuvColorMatrix = get_yuv_color_matrix(yuv_color_space);
    vYuvCoefficient = yuv_coefficient;
    vYuvFormat = yuv_format;

    write_uv_rect(
        aUvRect0.xy,
        aUvRect0.zw,
        aTextureLayers.x,
        uv,
        TEX_SIZE(sColor0),
        vUV_y,
        vUVBounds_y
    );
    write_uv_rect(
        aUvRect1.xy,
        aUvRect1.zw,
        aTextureLayers.y,
        uv,
        TEX_SIZE(sColor1),
        vUV_u,
        vUVBounds_u
    );
    write_uv_rect(
        aUvRect2.xy,
        aUvRect2.zw,
        aTextureLayers.z,
        uv,
        TEX_SIZE(sColor2),
        vUV_v,
        vUVBounds_v
    );
#else
    vUv = mix(aUvRect0.xy, aUvRect0.zw, uv);
    int rescale_uv = int(aParams.y);
    if (rescale_uv == 1)
        vUv /= TEX_SIZE(sColor0);
    // Pass through color
    vColor = aColor;
    vLayer = aTextureLayers.x;
#endif

    gl_Position = uTransform * vec4(clipped_world_pos, aParams.x /* z_id */, 1.0);
}
#endif

#ifdef WR_FRAGMENT_SHADER
void main(void) {
#ifdef WR_FEATURE_YUV
    vec4 color = sample_yuv(
        vYuvFormat,
        vYuvColorMatrix,
        vYuvCoefficient,
        vUV_y,
        vUV_u,
        vUV_v,
        vUVBounds_y,
        vUVBounds_u,
        vUVBounds_v
    );
#else
    // The color is just the texture sample modulated by a supplied color
#   if defined(WR_FEATURE_TEXTURE_EXTERNAL) || defined(WR_FEATURE_TEXTURE_2D) || defined(WR_FEATURE_TEXTURE_RECT)
    vec4 texel = TEX_SAMPLE(sColor0, vec3(vUv, vLayer));
#   else
    vec4 texel = textureLod(sColor0, vec3(vUv, vLayer), 0.0);
#   endif
    vec4 color = vColor * texel;
#endif
    write_output(color);
}
#endif
