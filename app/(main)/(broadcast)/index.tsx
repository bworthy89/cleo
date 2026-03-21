import { HomeScreenRedesign } from '../../../src/screens/home/HomeScreenRedesign';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function BroadcastHome() {
  return (
    <ErrorBoundary fallbackTitle="Broadcast unavailable">
      <HomeScreenRedesign />
    </ErrorBoundary>
  );
}
