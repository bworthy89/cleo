import { View, Text } from 'react-native';
import { Colors, TextColors } from '../../tokens/design-tokens';

export default function HomeBroadcastScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.base.black, padding: 24 }}>
      <Text style={{ color: TextColors.primary }}>HomeBroadcastScreen (stub)</Text>
    </View>
  );
}
