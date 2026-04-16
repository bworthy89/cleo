import { View, Text } from 'react-native';
import { Colors, TextColors } from '../../../src/tokens/design-tokens';

export default function BroadcastPlayerScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.base.black, padding: 24 }}>
      <Text style={{ color: TextColors.primary }}>BroadcastPlayer (scaffold)</Text>
    </View>
  );
}
