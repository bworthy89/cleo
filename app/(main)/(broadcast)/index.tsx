import HomeBroadcastScreen from '../../../src/screens/home/HomeBroadcastScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function BroadcastHome() {
  return (
    <ErrorBoundary fallbackTitle="Broadcast unavailable">
      <HomeBroadcastScreen />
    </ErrorBoundary>
  );
}
