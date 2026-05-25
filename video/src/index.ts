/**
 * Remotion entry point — registers the Root component with the
 * Remotion runtime. This file must exist at the path referenced by
 * remotion.config.ts (`Config.setEntryPoint('./src/index.ts')`).
 */
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
