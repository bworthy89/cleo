import { SessionArcScreen } from '../../../src/screens/arc/SessionArcScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function ArcRoute() {
  return (
    <ErrorBoundary fallbackTitle="Session arc unavailable">
      <SessionArcScreen />
    </ErrorBoundary>
  );
}
