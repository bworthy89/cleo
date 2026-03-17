import { Redirect } from 'expo-router';
import { getUser } from '../src/services/Storage';

export default function Index() {
  const user = getUser();

  if (!user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return <Redirect href="/(main)" />;
}
