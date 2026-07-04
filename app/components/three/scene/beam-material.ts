import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vT; // 0 at the lens (apex), 1 at the far end

  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    // Unit cone spans y in [-1, 0] (apex at origin, opening downward).
    vT = clamp(-position.y, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uAnglePower;
  uniform float uAxialDecay;
  uniform vec3 uBeamDirW;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vT;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Axial falloff: bright at the source, decaying toward the end.
    float axial = pow(clamp(1.0 - vT, 0.0, 1.0), uAxialDecay);
    // Fake volume: fragments whose surface normal faces the camera are
    // "deeper" through the cone → brighter core, feathered silhouette edges.
    // The 0.3 base fill keeps the cone body glowing when viewed near-parallel
    // to the beam axis, where facing collapses to ~0 for every fragment.
    float facing = abs(dot(normalize(vNormalW), viewDir));
    float radial = mix(0.3, 1.0, pow(facing, uAnglePower));
    float core = pow(facing, 6.0) * 0.7;
    // Fade when looking straight down the barrel to avoid a hard disc.
    float axisDot = abs(dot(normalize(uBeamDirW), viewDir));
    float barrel = 1.0 - smoothstep(0.9, 1.0, axisDot) * 0.5;
    // The stage floor is the ground plane — clip light below it.
    float floorClip = smoothstep(-0.02, 0.15, vWorldPos.y);
    float a = uIntensity * axial * (radial + core) * barrel * floorClip;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export function createBeamMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new Color(1, 1, 1) },
      uIntensity: { value: 0 },
      uAnglePower: { value: 2.2 },
      uAxialDecay: { value: 2.2 },
      uBeamDirW: { value: new Vector3(0, -1, 0) },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    toneMapped: false,
  });
}
