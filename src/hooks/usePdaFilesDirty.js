import { useSyncExternalStore } from 'react';
import { isPdaFilesDirty, subscribePdaFilesDirty } from '../pdaDirty';

export default function usePdaFilesDirty() {
  return useSyncExternalStore(subscribePdaFilesDirty, isPdaFilesDirty);
}
