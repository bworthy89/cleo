import AskOnayScreen from '../../../src/screens/curate/AskOnayScreen';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';

export default function CratesRoute() {
  return (
    <ErrorBoundary fallbackTitle="Crates unavailable">
      <AskOnayScreen />
    </ErrorBoundary>
  );
}
