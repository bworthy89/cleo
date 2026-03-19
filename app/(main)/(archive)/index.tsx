import { View, Text } from 'react-native';
import { Surface, TextColors } from '../../../src/tokens/design-tokens';

export default function ArchiveScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Surface.base, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: TextColors.primary, fontSize: 16 }}>Archive (placeholder)</Text>
    </View>
  );
}
