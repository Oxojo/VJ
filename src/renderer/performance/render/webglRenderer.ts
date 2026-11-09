import type { AudioMetrics, LayerConfig, MacroValues, QualityProfile } from '../../../shared/domain/types'
import type { PreparedSource } from '../media/sourceManager'

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const COMPOSE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_previous;
uniform ivec3 u_types;
uniform ivec3 u_blends;
uniform ivec3 u_fits;
uniform vec3 u_opacities;
uniform vec3 u_sourceAspects;
uniform vec3 u_seeds;
uniform vec4 u_solids[3];
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_beat;
uniform vec4 u_audio;
uniform vec4 u_macrosA;
uniform float u_echo;

const float PI = 3.14159265359;

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec2 mediaUv(vec2 uv, float sourceAspect, int fit) {
  vec2 p = uv - 0.5;
  float canvasAspect = u_resolution.x / u_resolution.y;
  float ratio = sourceAspect / canvasAspect;
  if (fit == 1) {
    if (ratio > 1.0) p.x /= ratio;
    else p.y *= ratio;
  } else {
    if (ratio > 1.0) p.y *= ratio;
    else p.x /= ratio;
  }
  return p + 0.5;
}

vec4 textureSource(int index, vec2 uv) {
  vec2 mapped = mediaUv(uv, u_sourceAspects[index], u_fits[index]);
  if (any(lessThan(mapped, vec2(0.0))) || any(greaterThan(mapped, vec2(1.0)))) return vec4(0.0);
  vec4 value = index == 0 ? texture(u_tex0, mapped) : index == 1 ? texture(u_tex1, mapped) : texture(u_tex2, mapped);
  value.rgb *= value.a;
  return value;
}

vec4 generated(int kind, vec2 uv, float seed) {
  vec2 p = uv * 2.0 - 1.0;
  p.x *= u_resolution.x / u_resolution.y;
  float phase = fract(u_beat);
  float pulse = exp(-phase * 7.0);
  float reactive = clamp(u_audio.x * 0.35 + u_audio.y * 0.75, 0.0, 1.0) * u_macrosA.w;
  float hue = fract(u_macrosA.x + seed * 0.013 + u_time * 0.012);
  vec3 color = hsv2rgb(vec3(hue, 0.78, 0.95));
  float alpha = 0.0;

  if (kind == 2) {
    float radius = 0.24 + pulse * 0.08 + reactive * 0.28;
    float distanceToRing = abs(length(p) - radius);
    alpha = smoothstep(0.055, 0.004, distanceToRing);
  } else if (kind == 3) {
    vec2 moved = p + vec2(phase * 0.35 * u_macrosA.y, 0.0);
    vec2 grid = abs(fract(moved * (3.0 + u_macrosA.y * 5.0)) - 0.5);
    alpha = smoothstep(0.47, 0.39, max(grid.x, grid.y)) * (0.55 + reactive * 0.45);
  } else if (kind == 4) {
    float wave = sin((p.y + p.x * 0.2 + phase * 1.5 * u_macrosA.y) * 32.0 + seed);
    alpha = smoothstep(0.88, 0.99, abs(wave)) * (0.5 + u_audio.w * 0.5);
  } else {
    float field = sin(p.x * 2.5 + u_time * 0.25) * cos(p.y * 2.0 - u_time * 0.18);
    color = mix(color, hsv2rgb(vec3(fract(hue + 0.35), 0.7, 0.9)), field * 0.5 + 0.5);
    alpha = 0.48 + reactive * 0.3;
  }
  return vec4(color * alpha, alpha);
}

vec4 sourceColor(int index, vec2 uv) {
  int kind = u_types[index];
  if (kind == 0) return vec4(0.0);
  if (kind == 1) return textureSource(index, uv);
  if (kind == 6) {
    vec4 solid = u_solids[index];
    solid.rgb *= solid.a;
    return solid;
  }
  return generated(kind, uv, u_seeds[index]);
}

vec4 blendLayer(vec4 under, vec4 over, int mode) {
  if (mode == 1) return min(vec4(1.0), under + over);
  if (mode == 2) {
    vec3 screen = 1.0 - (1.0 - under.rgb) * (1.0 - over.rgb);
    float alpha = over.a + under.a * (1.0 - over.a);
    return vec4(screen, alpha);
  }
  return over + under * (1.0 - over.a);
}

vec3 hueRotate(vec3 color, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  mat3 matrix = mat3(
    0.299 + 0.701*c + 0.168*s, 0.587 - 0.587*c + 0.330*s, 0.114 - 0.114*c - 0.497*s,
    0.299 - 0.299*c - 0.328*s, 0.587 + 0.413*c + 0.035*s, 0.114 - 0.114*c + 0.292*s,
    0.299 - 0.300*c + 1.250*s, 0.587 - 0.588*c - 1.050*s, 0.114 + 0.886*c - 0.203*s
  );
  return clamp(matrix * color, 0.0, 1.0);
}

void main() {
  vec2 p = v_uv - 0.5;
  float radius = length(p);
  float bend = u_macrosA.z * 0.08 * sin(radius * 18.0 - u_time * 1.4);
  vec2 uv = v_uv + normalize(p + vec2(0.0001)) * bend;
  vec4 composed = vec4(0.0);
  for (int index = 0; index < 3; index++) {
    vec4 layer = sourceColor(index, uv) * u_opacities[index];
    composed = blendLayer(composed, layer, u_blends[index]);
  }
  composed.rgb = hueRotate(composed.rgb, u_macrosA.x * PI * 2.0);
  vec4 previous = texture(u_previous, v_uv) * (u_echo * 0.975);
  outColor = max(composed, previous);
}`

const DISPLAY_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_frame;
uniform float u_brightness;
uniform float u_blackout;
void main() {
  vec4 frame = texture(u_frame, v_uv);
  outColor = vec4(frame.rgb * u_brightness * (1.0 - u_blackout), 1.0);
}`

interface FrameTarget {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
}

export interface RenderState {
  timeSec: number
  beat: number
  audio: AudioMetrics
  macros: MacroValues
  masterBrightness: number
  blackout: boolean
}

const TYPE_BY_GENERATOR = {
  'pulse-circle': 2,
  'offset-grid': 3,
  'moving-lines': 4,
  'gradient-field': 5
} as const

export class WebGlRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly composeProgram: WebGLProgram
  private readonly displayProgram: WebGLProgram
  private readonly vertexBuffer: WebGLBuffer
  private sourceTextures: WebGLTexture[] = []
  private history: FrameTarget[] = []
  private freezeTarget: FrameTarget | null = null
  private readIndex = 0
  private freezeEnabled = false
  private quality: QualityProfile = 'standard'

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL 2 is required')
    this.gl = gl
    this.composeProgram = this.createProgram(VERTEX_SHADER, COMPOSE_SHADER)
    this.displayProgram = this.createProgram(VERTEX_SHADER, DISPLAY_SHADER)
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('Unable to create vertex buffer')
    this.vertexBuffer = buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.sourceTextures = [0, 1, 2].map(() => this.createSourceTexture())
    this.setQuality('standard')
  }

  setQuality(quality: QualityProfile): void {
    this.quality = quality
    const [width, height] = quality === 'standard' ? [1920, 1080] : [1280, 720]
    this.canvas.width = width
    this.canvas.height = height
    this.recreateTargets(width, height)
  }

  get profile(): QualityProfile {
    return this.quality
  }

  setFreeze(enabled: boolean): void {
    if (enabled && !this.freezeEnabled) this.captureFreeze()
    this.freezeEnabled = enabled
  }

  clearHistory(): void {
    const gl = this.gl
    for (const target of [...this.history, ...(this.freezeTarget ? [this.freezeTarget] : [])]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  render(sources: Array<PreparedSource | null>, layers: LayerConfig[], state: RenderState): void {
    const gl = this.gl
    const writeIndex = 1 - this.readIndex
    const writeTarget = this.history[writeIndex]
    const previousTarget = this.history[this.readIndex]
    if (!writeTarget || !previousTarget) return

    gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.composeProgram)
    this.bindGeometry(this.composeProgram)

    const types = new Int32Array(3)
    const blends = new Int32Array(3)
    const fits = new Int32Array(3)
    const opacities = new Float32Array(3)
    const aspects = new Float32Array([16 / 9, 16 / 9, 16 / 9])
    const seeds = new Float32Array([3, 14, 25])
    const solids = new Float32Array(12)

    for (let index = 0; index < 3; index += 1) {
      const source = sources[index]
      const layer = layers[index]
      const texture = this.sourceTextures[index]
      if (!texture || !layer) continue
      gl.activeTexture(gl.TEXTURE0 + index)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      this.uploadElement(source ?? null)
      aspects[index] = source ? source.width / Math.max(1, source.height) : 16 / 9
      opacities[index] = layer.muted ? 0 : layer.opacity
      blends[index] = layer.blend === 'add' ? 1 : layer.blend === 'screen' ? 2 : 0
      fits[index] = layer.fit === 'cover' ? 1 : 0
      if (!source) types[index] = 0
      else if (source.source.kind === 'video' || source.source.kind === 'image') types[index] = 1
      else if (source.source.kind === 'generator') types[index] = TYPE_BY_GENERATOR[source.source.generatorId]
      else {
        types[index] = 6
        solids.set(source.source.color, index * 4)
      }
      if (source?.source.kind === 'generator') seeds[index] = source.source.seed
    }

    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, previousTarget.texture)
    this.uniform1i(this.composeProgram, 'u_tex0', 0)
    this.uniform1i(this.composeProgram, 'u_tex1', 1)
    this.uniform1i(this.composeProgram, 'u_tex2', 2)
    this.uniform1i(this.composeProgram, 'u_previous', 3)
    gl.uniform3iv(this.location(this.composeProgram, 'u_types'), types)
    gl.uniform3iv(this.location(this.composeProgram, 'u_blends'), blends)
    gl.uniform3iv(this.location(this.composeProgram, 'u_fits'), fits)
    gl.uniform3fv(this.location(this.composeProgram, 'u_opacities'), opacities)
    gl.uniform3fv(this.location(this.composeProgram, 'u_sourceAspects'), aspects)
    gl.uniform3fv(this.location(this.composeProgram, 'u_seeds'), seeds)
    gl.uniform4fv(this.location(this.composeProgram, 'u_solids[0]'), solids)
    gl.uniform2f(this.location(this.composeProgram, 'u_resolution'), this.canvas.width, this.canvas.height)
    gl.uniform1f(this.location(this.composeProgram, 'u_time'), state.timeSec)
    gl.uniform1f(this.location(this.composeProgram, 'u_beat'), state.beat)
    gl.uniform4f(
      this.location(this.composeProgram, 'u_audio'),
      state.audio.rms,
      state.audio.low,
      state.audio.mid,
      state.audio.high
    )
    gl.uniform4f(
      this.location(this.composeProgram, 'u_macrosA'),
      state.macros.color,
      state.macros.motion,
      state.macros.distort,
      state.macros.reactive
    )
    gl.uniform1f(this.location(this.composeProgram, 'u_echo'), state.macros.echo)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.readIndex = writeIndex

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.displayProgram)
    this.bindGeometry(this.displayProgram)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.freezeEnabled ? this.freezeTarget?.texture ?? writeTarget.texture : writeTarget.texture)
    this.uniform1i(this.displayProgram, 'u_frame', 0)
    gl.uniform1f(this.location(this.displayProgram, 'u_brightness'), state.masterBrightness)
    gl.uniform1f(this.location(this.displayProgram, 'u_blackout'), state.blackout ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  preview(): string {
    return this.canvas.toDataURL('image/webp', 0.6)
  }

  private uploadElement(source: PreparedSource | null): void {
    const gl = this.gl
    const element = source?.element
    if (!element) return
    if (element instanceof HTMLVideoElement && element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    if (element instanceof HTMLImageElement && !element.complete) return
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element)
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Unable to create shader')
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed')
      }
      return shader
    }
    const program = gl.createProgram()
    if (!program) throw new Error('Unable to create WebGL program')
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed')
    }
    return program
  }

  private bindGeometry(program: WebGLProgram): void {
    const gl = this.gl
    const location = gl.getAttribLocation(program, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
  }

  private createSourceTexture(): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()
    if (!texture) throw new Error('Unable to create source texture')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    return texture
  }

  private createTarget(width: number, height: number): FrameTarget {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('Unable to allocate frame target')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Incomplete WebGL framebuffer')
    }
    return { texture, framebuffer }
  }

  private recreateTargets(width: number, height: number): void {
    const gl = this.gl
    for (const target of [...this.history, ...(this.freezeTarget ? [this.freezeTarget] : [])]) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    this.history = [this.createTarget(width, height), this.createTarget(width, height)]
    this.freezeTarget = this.createTarget(width, height)
    this.readIndex = 0
    this.clearHistory()
  }

  private captureFreeze(): void {
    const gl = this.gl
    const source = this.history[this.readIndex]
    if (!source || !this.freezeTarget) return
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.freezeTarget.framebuffer)
    gl.blitFramebuffer(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private location(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(program, name)
    if (!location) throw new Error(`Missing shader uniform ${name}`)
    return location
  }

  private uniform1i(program: WebGLProgram, name: string, value: number): void {
    this.gl.uniform1i(this.location(program, name), value)
  }
}
