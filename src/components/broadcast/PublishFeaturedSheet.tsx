import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AM, Fonts, Space, TypeScale, AMGlow } from '../../tokens/design-tokens';
import {
  DAYS_ORDERED,
  buildSlotPrefill,
  shouldWarnVibeMismatch,
  type SlotPrefill,
} from './publishFeaturedSheet.helpers';
import {
  dayOfWeekFor,
  type SlotKey,
  type DayOfWeek,
} from '../../config/tonightOnOnay';
import type { Manifest } from '../../engines/BroadcastPlayer.types';
import type { PublishFeaturedRequest } from '../../engines/BroadcastCurationClient';
import { SectionMarker } from '../crate';

type Selection =
  | { kind: 'none' }
  | { kind: 'free'; title: string; description: string }
  | { kind: 'slot'; slot: SlotKey; prefill: SlotPrefill; titleOverride?: string; descOverride?: string };

interface Props {
  visible: boolean;
  /** The vibe the current Ask ONAY session was curated under — used for
   *  the soft vibe-mismatch warning when publishing into a slot. */
  sessionVibe?: Manifest['vibe'];
  /** Default free-form values when the curator picks "Free-form." */
  defaultTitle?: string;
  defaultDescription?: string;
  defaultVibe: Manifest['vibe'];
  defaultLength: Manifest['length'];
  /** Curator's local today — passed in so tests can inject a fixed date. */
  today?: DayOfWeek;
  publishing: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (req: Omit<PublishFeaturedRequest, 'tracks' | 'artworkUrl'>) => void;
}

export function PublishFeaturedSheet(props: Props) {
  const today = props.today ?? dayOfWeekFor(new Date());
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [morningDay, setMorningDay] = useState<DayOfWeek>(today);
  const [eveningDay, setEveningDay] = useState<DayOfWeek>(today);

  useEffect(() => {
    if (!props.visible) {
      setSelection({ kind: 'none' });
      setMorningDay(today);
      setEveningDay(today);
    }
  }, [props.visible, today]);

  const morningPrefill = useMemo(() => buildSlotPrefill('morning', morningDay), [morningDay]);
  const eveningPrefill = useMemo(() => buildSlotPrefill('evening', eveningDay), [eveningDay]);

  const pick = (next: Selection) => {
    Haptics.selectionAsync().catch(() => {});
    setSelection(next);
  };

  const canSubmit =
    selection.kind === 'slot'
      ? true
      : selection.kind === 'free' && selection.title.trim().length > 0;

  const submit = () => {
    if (!canSubmit || props.publishing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (selection.kind === 'free') {
      const slug = `${Date.now()}-${selection.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
      props.onSubmit({
        id: slug,
        title: selection.title.trim(),
        description: (selection.description ?? '').trim() || 'picked records, not algorithms.',
        vibe: props.defaultVibe,
        length: props.defaultLength,
      });
      return;
    }
    if (selection.kind === 'slot') {
      const p = selection.prefill;
      props.onSubmit({
        id: p.id,
        slot: p.slot,
        themeDay: p.themeDay,
        title: (selection.titleOverride ?? p.title).trim() || p.title,
        description: (selection.descOverride ?? p.description).trim() || p.description,
        vibe: p.vibe,
        length: p.length,
      });
    }
  };

  const ctaLabel =
    selection.kind === 'free' ? 'PUBLISH AS FEATURED'
    : selection.kind === 'slot' ? `PUBLISH AS TONIGHT'S ${selection.slot.toUpperCase()}`
    : 'CHOOSE A SLOT';

  return (
    <Modal visible={props.visible} animationType="slide" transparent={false} onRequestClose={props.onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={props.onClose}
            accessibilityRole="button"
            accessibilityLabel="Close publish sheet"
            style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
          <SectionMarker num="P·01" title="PUBLISH AS FEATURED" side="AS TONIGHT ON ONAY" />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <FreeFormTile
            selected={selection.kind === 'free'}
            title={selection.kind === 'free' ? selection.title : (props.defaultTitle ?? '')}
            description={selection.kind === 'free' ? selection.description : (props.defaultDescription ?? '')}
            onSelect={() => pick({
              kind: 'free',
              title: props.defaultTitle ?? '',
              description: props.defaultDescription ?? '',
            })}
            onTitleChange={(t) =>
              selection.kind === 'free' && setSelection({ ...selection, title: t })
            }
            onDescriptionChange={(d) =>
              selection.kind === 'free' && setSelection({ ...selection, description: d })
            }
          />

          <SlotTile
            slot="morning"
            today={today}
            day={morningDay}
            prefill={morningPrefill}
            selected={selection.kind === 'slot' && selection.slot === 'morning'}
            titleOverride={selection.kind === 'slot' && selection.slot === 'morning' ? selection.titleOverride : undefined}
            descOverride={selection.kind === 'slot' && selection.slot === 'morning' ? selection.descOverride : undefined}
            onSelect={() => pick({ kind: 'slot', slot: 'morning', prefill: morningPrefill })}
            onDayChange={(d) => {
              setMorningDay(d);
              if (selection.kind === 'slot' && selection.slot === 'morning') {
                pick({ kind: 'slot', slot: 'morning', prefill: buildSlotPrefill('morning', d) });
              }
            }}
            onTitleChange={(t) =>
              selection.kind === 'slot' && selection.slot === 'morning' &&
              setSelection({ ...selection, titleOverride: t })
            }
            onDescChange={(d) =>
              selection.kind === 'slot' && selection.slot === 'morning' &&
              setSelection({ ...selection, descOverride: d })
            }
          />

          <SlotTile
            slot="evening"
            today={today}
            day={eveningDay}
            prefill={eveningPrefill}
            selected={selection.kind === 'slot' && selection.slot === 'evening'}
            titleOverride={selection.kind === 'slot' && selection.slot === 'evening' ? selection.titleOverride : undefined}
            descOverride={selection.kind === 'slot' && selection.slot === 'evening' ? selection.descOverride : undefined}
            onSelect={() => pick({ kind: 'slot', slot: 'evening', prefill: eveningPrefill })}
            onDayChange={(d) => {
              setEveningDay(d);
              if (selection.kind === 'slot' && selection.slot === 'evening') {
                pick({ kind: 'slot', slot: 'evening', prefill: buildSlotPrefill('evening', d) });
              }
            }}
            onTitleChange={(t) =>
              selection.kind === 'slot' && selection.slot === 'evening' &&
              setSelection({ ...selection, titleOverride: t })
            }
            onDescChange={(d) =>
              selection.kind === 'slot' && selection.slot === 'evening' &&
              setSelection({ ...selection, descOverride: d })
            }
          />

          {selection.kind === 'slot' &&
            shouldWarnVibeMismatch(props.sessionVibe, selection.prefill.vibe) && (
              <Text style={styles.warning}>
                This slot's vibe is <Text style={styles.warningEm}>{selection.prefill.vibe}</Text>.
                {' '}I'll re-voice the commentary for the slot angle.
              </Text>
          )}

          {props.error ? <Text style={styles.errorBand}>{props.error}</Text> : null}
        </ScrollView>

        <Pressable
          disabled={!canSubmit || props.publishing}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [
            styles.cta,
            (!canSubmit || props.publishing) && styles.ctaDisabled,
            pressed && canSubmit && !props.publishing && { opacity: 0.85 },
          ]}
        >
          {props.publishing
            ? (<><ActivityIndicator color={AM.bg} /><Text style={styles.ctaLabel}>  BAKING…</Text></>)
            : <Text style={styles.ctaLabel}>{ctaLabel}</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

// ─────────────────────────── Tiles ───────────────────────────────────

interface FreeFormTileProps {
  selected: boolean;
  title: string;
  description: string;
  onSelect: () => void;
  onTitleChange: (t: string) => void;
  onDescriptionChange: (d: string) => void;
}

function FreeFormTile(p: FreeFormTileProps) {
  return (
    <Pressable
      onPress={p.onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.selected }}
      style={[styles.tile, p.selected && styles.tileSelected]}
    >
      <Text style={styles.tileEyebrow}>FREE-FORM</Text>
      <Text style={styles.tileTitle}>Name your own drop</Text>
      <Text style={styles.tileBody}>Standalone featured broadcast — not a Morning or Evening slot.</Text>
      {p.selected && (
        <View style={styles.editBlock}>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            value={p.title}
            onChangeText={p.onTitleChange}
            placeholder="e.g. Post-rain dispatch"
            placeholderTextColor={AM.inkDim}
            maxLength={120}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            value={p.description}
            onChangeText={p.onDescriptionChange}
            placeholder="one warm sentence"
            placeholderTextColor={AM.inkDim}
            maxLength={400}
            multiline
            style={[styles.input, styles.inputMulti]}
          />
        </View>
      )}
    </Pressable>
  );
}

interface SlotTileProps {
  slot: SlotKey;
  today: DayOfWeek;
  day: DayOfWeek;
  prefill: SlotPrefill;
  selected: boolean;
  titleOverride?: string;
  descOverride?: string;
  onSelect: () => void;
  onDayChange: (d: DayOfWeek) => void;
  onTitleChange: (t: string) => void;
  onDescChange: (d: string) => void;
}

function SlotTile(p: SlotTileProps) {
  return (
    <Pressable
      onPress={p.onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.selected }}
      style={[styles.tile, p.selected && styles.tileSelected]}
    >
      <Text style={styles.tileEyebrow}>
        {p.slot.toUpperCase()} · {p.day.toUpperCase()}
      </Text>
      <Text style={styles.tileTitle}>{p.prefill.title}</Text>
      <Text style={styles.tileBody}>{p.prefill.description}</Text>
      <Text style={styles.vibeChip}>{p.prefill.vibe.toUpperCase()} · {p.prefill.length.toUpperCase()}</Text>

      {p.selected && (
        <View style={styles.editBlock}>
          <Text style={styles.fieldLabel}>DAY</Text>
          <View style={styles.dayRow}>
            {DAYS_ORDERED.map(d => {
              const isActive = d === p.day;
              const isToday = d === p.today;
              return (
                <Pressable
                  key={d}
                  onPress={() => p.onDayChange(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Set theme day ${d}`}
                  style={({ pressed }) => [
                    styles.dayChip,
                    isActive && styles.dayChipActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.dayChipText, isActive && styles.dayChipTextActive]}>
                    {d.toUpperCase()}
                  </Text>
                  {isToday && !isActive ? <View style={styles.dayDot} /> : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            value={p.titleOverride ?? p.prefill.title}
            onChangeText={p.onTitleChange}
            maxLength={120}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>DESCRIPTION</Text>
          <TextInput
            value={p.descOverride ?? p.prefill.description}
            onChangeText={p.onDescChange}
            maxLength={400}
            multiline
            style={[styles.input, styles.inputMulti]}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AM.bg },
  header: {
    paddingTop: Space.s20, paddingHorizontal: Space.s16, paddingBottom: Space.s12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  close: { padding: Space.s8 },
  closeGlyph: { color: AM.ink, fontSize: TypeScale.s26, fontFamily: Fonts.display },

  body: { paddingHorizontal: Space.s16, paddingBottom: Space.s40 },

  tile: {
    marginTop: Space.s14,
    paddingVertical: Space.s14, paddingHorizontal: Space.s14,
    borderLeftWidth: 2, borderLeftColor: AM.amber,
    backgroundColor: AM.bgDeep,
  },
  tileSelected: { ...AMGlow.cta, borderLeftColor: AM.amber, backgroundColor: AM.bgDeep  },
  tileEyebrow: { color: AM.amber, fontFamily: Fonts.mono, fontSize: TypeScale.s10, letterSpacing: 2.5 },
  tileTitle: { marginTop: 6, color: AM.ink, fontFamily: Fonts.display, fontSize: TypeScale.s22, letterSpacing: 0.3 },
  tileBody: { marginTop: 6, color: AM.inkMid, fontFamily: Fonts.serif, fontSize: TypeScale.s13, lineHeight: TypeScale.s13 * 1.45 },
  vibeChip: { marginTop: Space.s10, color: AM.amberDim, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2 },

  editBlock: { marginTop: Space.s14, borderTopWidth: 1, borderTopColor: AM.rule, paddingTop: Space.s12 },
  fieldLabel: { color: AM.amber, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2, marginTop: Space.s10 },
  input: {
    marginTop: 4, color: AM.ink, fontFamily: Fonts.serif, fontSize: TypeScale.s14,
    borderBottomWidth: 1, borderBottomColor: AM.rule, paddingVertical: Space.s6,
  },
  inputMulti: { minHeight: 60, textAlignVertical: 'top' },

  dayRow: { flexDirection: 'row', gap: Space.s6, marginTop: 6, flexWrap: 'wrap' },
  dayChip: {
    paddingHorizontal: Space.s8, paddingVertical: 4,
    borderWidth: 1, borderColor: AM.rule, minWidth: 42, alignItems: 'center',
  },
  dayChipActive: { borderColor: AM.amber, backgroundColor: AM.amberFaint },
  dayChipText: { color: AM.inkMid, fontFamily: Fonts.mono, fontSize: TypeScale.s9, letterSpacing: 2 },
  dayChipTextActive: { color: AM.amber },
  dayDot: {
    width: 3, height: 3, borderRadius: 1.5, backgroundColor: AM.amber,
    position: 'absolute', bottom: 2, alignSelf: 'center',
  },

  warning: {
    marginTop: Space.s14,
    color: AM.inkMid, fontFamily: Fonts.serif, fontStyle: 'italic',
    fontSize: TypeScale.s13, lineHeight: TypeScale.s13 * 1.5,
  },
  warningEm: { color: AM.amber, fontStyle: 'italic' },
  errorBand: {
    marginTop: Space.s14,
    color: AM.oxblood, fontFamily: Fonts.mono, fontSize: TypeScale.s10, letterSpacing: 2,
  },

  cta: {
    margin: Space.s16,
    paddingVertical: Space.s16,
    backgroundColor: AM.amber,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
    ...AMGlow.cta,
  },
  ctaDisabled: { backgroundColor: AM.amberDim, opacity: 0.4, shadowOpacity: 0 },
  ctaLabel: { color: AM.bg, fontFamily: Fonts.mono, fontSize: TypeScale.s12, letterSpacing: 3 },
});
