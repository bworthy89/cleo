import { ProfileScreen } from '../../../src/screens/settings/ProfileScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function CleoRoute() {
  return (
    <ErrorBoundary fallbackTitle="ONAY unavailable">
      <ProfileScreen />
    </ErrorBoundary>
  );
}
