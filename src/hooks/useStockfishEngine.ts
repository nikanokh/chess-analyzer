import { useEffect, useState } from 'react';
import { stockfishClient } from '../core/engine/StockfishClient';
import { EngineState } from '../types/chess';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useGameStore } from '../stores/useGameStore';
import { findNodeById } from '../core/chess/VariationTree';

export function useStockfishEngine() {
  const [engineState, setEngineState] = useState<EngineState>(() => stockfishClient.getState());
  const engineConfig = useSettingsStore((s) => s.settings.engineConfig);
  const rootNode = useGameStore((s) => s.rootNode);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const isBatchAnalyzing = useGameStore((s) => s.isBatchAnalyzing);

  const currentNode = findNodeById(rootNode, currentNodeId) || rootNode;

  useEffect(() => {
    stockfishClient.init().catch((err) => {
      console.error('Stockfish initialization error:', err);
    });
    const unsubscribe = stockfishClient.subscribe((state) => {
      setEngineState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isBatchAnalyzing) return;
    stockfishClient.analyzePosition(
      currentNode.fen,
      engineConfig.depth,
      engineConfig.movetimeMs
    );
  }, [
    currentNode.fen,
    engineConfig.depth,
    engineConfig.movetimeMs,
    engineConfig.multiPv,
    engineConfig.hashMb,
    engineConfig.threads,
    engineConfig.ponder,
    isBatchAnalyzing,
  ]);

  return engineState;
}
