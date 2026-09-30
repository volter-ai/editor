import * as THREE from 'three';

/** The document's holder has no animated pose of its own. Three recomposes a
 * Scene on every render pass and marks it dirty even when its matrix is exactly
 * unchanged, which forces every static descendant's world matrix to be rebuilt.
 * Preserve genuine dirty/forced updates and Three's normal child traversal;
 * avoid creating a new dirty state solely from an unchanged holder pose. */
export class DocumentScene extends THREE.Scene {
  private readonly previousMatrix = new THREE.Matrix4();

  override updateMatrix(): void {
    const dirty = this.matrixWorldNeedsUpdate;
    this.previousMatrix.copy(this.matrix);
    super.updateMatrix();
    if (!dirty && this.previousMatrix.equals(this.matrix)) this.matrixWorldNeedsUpdate = false;
  }
}
