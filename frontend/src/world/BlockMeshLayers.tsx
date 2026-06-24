import type { BufferGeometry, Material } from "three";

import type { BlockMesh } from "./blockAdapter";

/** Renders opaque and transparent layers from a `buildBlockMesh` result. */
export function BlockMeshLayers({
  mesh,
  material,
  transparentRenderOrder = 1,
  dispose = null,
}: {
  mesh: BlockMesh;
  /** When set, used for both layers (e.g. ghost overlay). Otherwise each layer keeps its own material. */
  material?: Material;
  transparentRenderOrder?: number;
  dispose?: null;
}) {
  return (
    <>
      {mesh.opaque ? (
        <mesh
          geometry={mesh.opaque.geometry}
          material={material ?? mesh.opaque.material}
          dispose={dispose}
        />
      ) : null}
      {mesh.transparent ? (
        <mesh
          geometry={mesh.transparent.geometry}
          material={material ?? mesh.transparent.material}
          renderOrder={transparentRenderOrder}
          dispose={dispose}
        />
      ) : null}
    </>
  );
}

export function blockMeshGeometries(
  mesh: BlockMesh | null,
): BufferGeometry[] {
  if (!mesh) return [];
  return [mesh.opaque?.geometry, mesh.transparent?.geometry].filter(
    (g): g is NonNullable<typeof g> => g != null,
  );
}
