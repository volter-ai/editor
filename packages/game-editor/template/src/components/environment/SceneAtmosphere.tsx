import { createPortal, useThree } from '@react-three/fiber';

/** Native Fiber scene attachments. Their constructor literals remain the
 * project's source of truth and are directly tunable in the World Inspector. */
export function SceneAtmosphere() {
  const scene = useThree((state) => state.scene);
  return createPortal(
    <>
      <color attach="background" args={['#a9d8f2']} />
      <fog attach="fog" args={['#c8e3ef', 32, 105]} />
    </>,
    scene,
  );
}
