import TonightScreen from '../../../src/screens/tonight/TonightScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function TonightRoute() {
  return (
    <ErrorBoundary fallbackTitle="Tonight unavailable">
      <TonightScreen />
    </ErrorBoundary>
  );
}
