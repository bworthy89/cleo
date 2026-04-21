import { BroadcastOrchestrator } from '@/services/broadcast/BroadcastOrchestrator';

describe('BroadcastOrchestrator sequencer selection', () => {
  const originalEnv = process.env.SEQUENCER_MODE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SEQUENCER_MODE;
    else process.env.SEQUENCER_MODE = originalEnv;
  });

  it('defaults to DeterministicTrackSequencer when env is unset', () => {
    delete process.env.SEQUENCER_MODE;
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('deterministic');
  });

  it('uses LLMTrackSequencer when SEQUENCER_MODE=llm', () => {
    process.env.SEQUENCER_MODE = 'llm';
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('llm');
  });

  it('uses deterministic when SEQUENCER_MODE is any other string', () => {
    process.env.SEQUENCER_MODE = 'gibberish';
    const orch = BroadcastOrchestrator.makeWithDefaults();
    expect(orch.sequencerMode).toBe('deterministic');
  });
});
