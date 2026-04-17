import { HomeScreenRedesign } from '../../../src/screens/home/HomeScreenRedesign';
import HomeBroadcastScreen from '../../../src/screens/home/HomeBroadcastScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';
import { FLAGS } from '../../../src/config/flags';

export default function BroadcastHome() {
  return (
    <ErrorBoundary fallbackTitle="Broadcast unavailable">
      {FLAGS.broadcastHome ? <HomeBroadcastScreen /> : <HomeScreenRedesign />}
    </ErrorBoundary>
  );
}
