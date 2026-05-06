import { Cull, Identifier, type Mesh as DeepslateMesh } from "deepslate";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  type Material,
} from "three";

import type { BlockProviders } from "./atlas";

export interface BlockMesh {
  geometry: BufferGeometry;
  material: Material;
  // Pre-baked transform from MC block-space (16 units / block) to scene-space
  // (1 unit / block). Geometry already has this baked in, so identity for now;
  // exposed for #0023 instancing where the per-instance translation goes here.
  transform: Matrix4;
}

let sharedMaterial: Material | null = null;

export function getSharedMaterial(providers: BlockProviders): Material {
  if (sharedMaterial) return sharedMaterial;
  sharedMaterial = new MeshStandardMaterial({
    map: providers.atlasTexture,
    vertexColors: true,
    alphaTest: 0.1,
    side: DoubleSide,
    metalness: 0,
    roughness: 1,
  });
  return sharedMaterial;
}

// Resets the cached shared material — used by tests / hot reload.
export function resetSharedMaterial(): void {
  sharedMaterial?.dispose();
  sharedMaterial = null;
}

export function buildBlockMesh(
  blockId: string,
  properties: Record<string, string>,
  providers: BlockProviders,
): BlockMesh | null {
  const id = Identifier.parse(blockId);
  const definition = providers.blockDefinitions.getBlockDefinition(id);
  if (!definition) return null;

  let mesh: DeepslateMesh;
  try {
    mesh = definition.getMesh(
      id,
      properties,
      providers.atlas,
      providers.blockModels,
      Cull.none(),
    );
  } catch (err) {
    console.warn(`blockAdapter: getMesh failed for ${blockId}`, err);
    return null;
  }

  if (mesh.quads.length === 0) return null;

  const geometry = meshToBufferGeometry(mesh);
  const material = getSharedMaterial(providers);
  return { geometry, material, transform: new Matrix4() };
}

function meshToBufferGeometry(mesh: DeepslateMesh): BufferGeometry {
  const quads = mesh.quads;
  const vertCount = quads.length * 4;
  const idxCount = quads.length * 6;

  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(idxCount);

  let vi = 0;
  let ii = 0;
  for (let q = 0; q < quads.length; q++) {
    const quad = quads[q]!;
    const verts = [quad.v1, quad.v2, quad.v3, quad.v4];
    const baseIdx = vi;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (verts[0]?.normal) {
      const n = verts[0].normal;
      nx = n.x;
      ny = n.y;
      nz = n.z;
    } else {
      const n = quad.normal();
      nx = n.x;
      ny = n.y;
      nz = n.z;
    }

    for (const v of verts) {
      // deepslate's BlockDefinition.getMesh already scales the mesh by 1/16,
      // so vertex positions arrive in scene units (1 = one block). Don't scale
      // again here.
      positions[vi * 3 + 0] = v.pos.x;
      positions[vi * 3 + 1] = v.pos.y;
      positions[vi * 3 + 2] = v.pos.z;

      const vn = v.normal;
      if (vn) {
        normals[vi * 3 + 0] = vn.x;
        normals[vi * 3 + 1] = vn.y;
        normals[vi * 3 + 2] = vn.z;
      } else {
        normals[vi * 3 + 0] = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;
      }

      const tex = v.texture ?? [0, 0];
      uvs[vi * 2 + 0] = tex[0];
      // deepslate emits UVs with the MC top-left convention; three.js wants
      // bottom-left, so flip V.
      uvs[vi * 2 + 1] = 1 - tex[1];

      const c = v.color;
      colors[vi * 3 + 0] = c[0];
      colors[vi * 3 + 1] = c[1];
      colors[vi * 3 + 2] = c[2];

      vi++;
    }

    indices[ii++] = baseIdx + 0;
    indices[ii++] = baseIdx + 1;
    indices[ii++] = baseIdx + 2;
    indices[ii++] = baseIdx + 0;
    indices[ii++] = baseIdx + 2;
    indices[ii++] = baseIdx + 3;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setAttribute("uv", new BufferAttribute(uvs, 2));
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.setIndex(new BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
