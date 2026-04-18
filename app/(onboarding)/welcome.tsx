import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { AM, Fonts, Space, TypeScale } from '../../src/tokens/design-tokens';
import { BroadcastBackdrop } from '../../src/components/BroadcastBackdrop';
import { SleeveArt, Tick, SpinningRecord, VUMeter } from '../../src/components/crate';
import { useAppActive } from '../../src/hooks/useAppActive';

/**
 * Onboarding tour — four animated frames:
 *   01 · TUNING IN — dial sweeps across frequencies, locks on ONAY · 97.6 FM · 23:58
 *   02 · TONIGHT   — crate of sleeves fans out, oxblood TONIGHT plate stamps in
 *   03 · ASK       — typewriter-fill input, tonearm thinks, catalog plate lands
 *   04 · BEGIN     — record queued on platter, DROP THE NEEDLE → into music-auth
 *
 * Skip link at the bottom. Next button advances; oxblood stamp on the final frame.
 */
export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const total = 4;

  // Frame entrance animation — fade + translateY, replaying on step change.
  // Each frame component relies on `key={step}` to remount its own internal
  // effects (dial sweep, crate fan, typewriter), so we drive this Animated
  // wrapper separately.
  const frameOpacity = useRef(new Animated.Value(1)).current;
  const frameTranslateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    frameOpacity.setValue(0);
    frameTranslateY.setValue(6);
    Animated.parallel([
      Animated.timing(frameOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(frameTranslateY, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [step, frameOpacity, frameTranslateY]);

  const next = () => {
    Haptics.selectionAsync().catch(() => {});
    if (step < total - 1) {
      setStep(step + 1);
    } else {
      router.push('/(onboarding)/music-auth');
    }
  };
  const prev = () => {
    Haptics.selectionAsync().catch(() => {});
    if (step > 0) setStep(step - 1);
  };
  const skip = () => router.push('/(onboarding)/music-auth');

  return (
    <BroadcastBackdrop>
      <View style={[styles.root, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }]}>
        {/* Progress bar — four ticks */}
        <View style={styles.progressRow}>
          {Array.from({ length: total }).map((_, i) => (
            <View
              key={i}
              style={[styles.progressTick, { backgroundColor: i <= step ? AM.amber : AM.inkGhost }]}
            />
          ))}
        </View>
        <View style={styles.progressLabels}>
          <Text style={styles.progressMono}>
            SIDE A · {String(step + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </Text>
          <Text style={styles.progressMono}>
            {['TUNING IN', 'TONIGHT', 'ASK', 'BEGIN'][step]}
          </Text>
        </View>

        {/* Frame stack — only active one rendered so internal animations
            restart cleanly. Outer Animated.View fades + lifts each frame in
            on step change (420ms ease-out). */}
        <Animated.View
          key={step}
          style={[
            styles.frameWrap,
            {
              opacity: frameOpacity,
              transform: [{ translateY: frameTranslateY }],
            },
          ]}
        >
          {step === 0 && <FrameTuneIn />}
          {step === 1 && <FrameTonight />}
          {step === 2 && <FrameAsk />}
          {step === 3 && <FrameBegin />}
        </Animated.View>

        {/* Footer — back + next/drop the needle */}
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Pressable
              onPress={prev}
              disabled={step === 0}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={10}
              style={({ pressed }) => [styles.footerSide, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.footerBack, step === 0 && { color: AM.inkGhost }]}>
                {step > 0 ? '← BACK' : ''}
              </Text>
            </Pressable>

            <Pressable
              onPress={next}
              accessibilityRole="button"
              accessibilityLabel={step < total - 1 ? 'Next' : 'Drop the needle'}
              style={({ pressed }) => [styles.next, pressed && { opacity: 0.85 }]}
            >
              {step < total - 1 ? (
                <View style={styles.nextAmber}>
                  <Tick pos="tl" color={AM.amber} bg={AM.bg} />
                  <Tick pos="tr" color={AM.amber} bg={AM.bg} />
                  <Tick pos="bl" color={AM.amber} bg={AM.bg} />
                  <Tick pos="br" color={AM.amber} bg={AM.bg} />
                  <Text style={styles.nextAmberText}>NEXT SIDE →</Text>
                </View>
              ) : (
                <View style={styles.nextOxblood}>
                  <Text style={styles.nextOxbloodText}>DROP THE NEEDLE →</Text>
                </View>
              )}
            </Pressable>

            <View style={styles.footerSide} />
          </View>

          {/* De-emphasized skip */}
          {step < total - 1 && (
            <Pressable
              onPress={skip}
              accessibilityRole="button"
              accessibilityLabel="Skip the tour"
              hitSlop={6}
              style={({ pressed }) => [styles.skip, pressed && { opacity: 0.5 }]}
            >
              <Text style={styles.skipText}>skip — take me in</Text>
            </Pressable>
          )}
        </View>
      </View>
    </BroadcastBackdrop>
  );
}

// ─────────────── Frame 01 · TUNING IN ───────────────

function FrameTuneIn() {
  const appActive = useAppActive();
  const sweep = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!appActive) return;
    Animated.sequence([
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2400,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start();
    Animated.timing(labelOpacity, {
      toValue: 1,
      duration: 400,
      delay: 1800,
      useNativeDriver: true,
    }).start();
  }, [appActive, sweep, labelOpacity]);

  const needleRot = sweep.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: ['-70deg', '44deg', '36deg'],
  });

  return (
    <View style={styles.frame}>
      {/* Dial face — SVG handles ticks + labels + hub deterministically */}
      <View style={styles.dial}>
        <Svg
          width={DIAL_SIZE}
          height={DIAL_SIZE}
          viewBox={`${-DIAL_SIZE / 2} ${-DIAL_SIZE / 2} ${DIAL_SIZE} ${DIAL_SIZE}`}
          style={StyleSheet.absoluteFill}
        >
          {/* Tick marks — 29 radiating from center between -70° and +70° */}
          {Array.from({ length: 29 }).map((_, i) => {
            const deg = -70 + i * 5;
            const rad = (deg * Math.PI) / 180;
            const r1 = 130;
            const r2 = i % 2 === 0 ? 118 : 124;
            const major = i % 4 === 0;
            return (
              <Line
                key={i}
                x1={Math.sin(rad) * r1}
                y1={-Math.cos(rad) * r1}
                x2={Math.sin(rad) * r2}
                y2={-Math.cos(rad) * r2}
                stroke={major ? AM.amberDim : AM.inkDim}
                strokeWidth={major ? 1.3 : 0.6}
              />
            );
          })}

          {/* FM frequency labels — 5 around the top arc */}
          {[[-60, '88'], [-30, '92'], [0, '96'], [30, '100'], [60, '104']].map(([d, l]) => {
            const deg = d as number;
            const rad = (deg * Math.PI) / 180;
            return (
              <SvgText
                key={l as string}
                x={Math.sin(rad) * 102}
                y={-Math.cos(rad) * 102 + 4}
                fill={AM.inkMid}
                fontFamily={Fonts.mono}
                fontSize={10}
                textAnchor="middle"
              >
                {l as string}
              </SvgText>
            );
          })}

          {/* Center hub — outer ring + amber core */}
          <Circle cx={0} cy={0} r={55} fill="none" stroke={AM.amberDim} strokeWidth={0.8} />
          <Circle cx={0} cy={0} r={8} fill={AM.amber} />
        </Svg>

        {/* Sweeping needle — anchor is a zero-sized View pinned at dial center;
            the needle bar hangs upward from the anchor so rotation pivots on dial center. */}
        <Animated.View
          style={[
            styles.needleAnchor,
            { transform: [{ rotate: needleRot }] },
          ]}
          pointerEvents="none"
        >
          <View style={styles.needleBar} />
        </Animated.View>

        {/* Locked label overlay — center of the dial */}
        <Animated.View style={[styles.dialLabel, { opacity: labelOpacity }]} pointerEvents="none">
          <Text style={styles.dialLocked}>LOCKED</Text>
          <Text style={styles.dialOnay}>ONAY</Text>
          <Text style={styles.dialFreq}>97.6 FM · 23:58</Text>
        </Animated.View>
      </View>

      {/* VU meter under the dial */}
      <View style={{ marginTop: Space.s22, alignItems: 'center' }}>
        <VUMeter level={0.85} bars={13} barWidth={4} height={32} gap={4} />
      </View>

      {/* Copy */}
      <View style={styles.copyBlock}>
        <Text style={styles.copyHeadline}>Turn the dial.{'\n'}You&rsquo;ve found us.</Text>
        <Text style={styles.copyTagline}>
          ONAY is a late-night broadcast. One DJ, one set, one record at a time.
          You didn&rsquo;t build a playlist. You just walked into the room.
        </Text>
      </View>
    </View>
  );
}

// ─────────────── Frame 02 · TONIGHT ───────────────

function FrameTonight() {
  const appActive = useAppActive();
  const stampScale = useRef(new Animated.Value(2.4)).current;
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const crateAnims = useRef(
    [0, 1, 2, 3, 4].map(() => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (!appActive) return;
    crateAnims.forEach((v, i) => {
      Animated.timing(v, {
        toValue: 1,
        duration: 500,
        delay: i * 90,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    Animated.parallel([
      Animated.timing(stampScale, { toValue: 1, duration: 540, delay: 650, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      Animated.timing(stampOpacity, { toValue: 1, duration: 300, delay: 650, useNativeDriver: true }),
    ]).start();
  }, [appActive, crateAnims, stampScale, stampOpacity]);

  const crate = [
    { v: 0 as const, t: 'After Hours', a: 'Ben Webster',    x: -90,  r: -14 },
    { v: 1 as const, t: 'Night Owl',   a: 'Tony Bennett',   x: -45,  r: -7 },
    { v: 2 as const, t: 'The Garden',  a: 'Francis Bebey',  x: 0,    r: 0 },
    { v: 0 as const, t: 'Late Set',    a: 'Alice Coltrane', x: 45,   r: 7 },
    { v: 1 as const, t: '4 AM',        a: 'Bill Evans',     x: 90,   r: 14 },
  ];

  return (
    <View style={styles.frame}>
      <View style={styles.crate}>
        {crate.map((c, i) => {
          const v = crateAnims[i];
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: 30,
                marginLeft: -50,
                opacity: i === 2 ? v : v.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }),
                zIndex: i === 2 ? 5 : (i < 2 ? i : 4 - i) + 1,
                transform: [
                  { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, c.x] }) },
                  { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${c.r}deg`] }) },
                ],
              }}
            >
              <SleeveArt title={c.t} artist={c.a} size={100} variant={c.v} />
            </Animated.View>
          );
        })}

        {/* Oxblood TONIGHT stamp */}
        <Animated.View
          style={[
            styles.tonightStamp,
            {
              opacity: stampOpacity,
              transform: [
                { translateX: -84 },
                { scale: stampScale },
                { rotate: '-2deg' },
              ],
            },
          ]}
        >
          <Text style={styles.tonightStampText}>TONIGHT ON ONAY</Text>
        </Animated.View>
      </View>

      {/* Liner excerpt */}
      <View style={styles.linerExcerpt}>
        <Text style={styles.linerKicker}>FRANCIS BEBEY · "THE GARDEN" · 1972</Text>
        <Text style={styles.linerBody}>
          "A Cameroonian guitarist in a Paris apartment, humming to himself.
          I kept coming back to this one. Tonight feels right."
        </Text>
      </View>

      <View style={styles.copyBlock}>
        <Text style={styles.copyHeadline}>
          One record a night.{'\n'}Picked, not generated.
        </Text>
        <Text style={styles.copyTagline}>
          Every evening, ONAY pulls one record from the crate and writes you a note
          about why. Read it before you press play.
        </Text>
      </View>
    </View>
  );
}

// ─────────────── Frame 03 · ASK ───────────────

function FrameAsk() {
  const appActive = useAppActive();
  const [phase, setPhase] = useState<'typing' | 'thinking' | 'result'>('typing');
  const type = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const caretOp = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!appActive) return;
    Animated.timing(type, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: false }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(caretOp, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(caretOp, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    ).start();
    const t1 = setTimeout(() => setPhase('thinking'), 2400);
    const t2 = setTimeout(() => {
      setPhase('result');
      Animated.timing(cardOpacity, { toValue: 1, duration: 440, useNativeDriver: true }).start();
    }, 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [appActive, type, caretOp, cardOpacity]);

  const typeWidth = type.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.frame}>
      <View>
        <Text style={styles.askKicker}>ASK ONAY · REQUEST SLIP</Text>
        <Text style={styles.askHeadline}>Ask in your{'\n'}own words.</Text>
      </View>

      {/* Typewriter input */}
      <View style={styles.askField}>
        <Tick pos="tl" color={AM.amberDim} bg={AM.bg} />
        <Tick pos="tr" color={AM.amberDim} bg={AM.bg} />
        <Tick pos="bl" color={AM.amberDim} bg={AM.bg} />
        <Tick pos="br" color={AM.amberDim} bg={AM.bg} />
        <Text style={styles.askFieldLabel}>YOUR REQUEST</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }}>
          <Animated.Text
            numberOfLines={1}
            style={[styles.askFieldText, { width: typeWidth }]}
          >
            "something for cleaning the kitchen"
          </Animated.Text>
          {phase === 'typing' && (
            <Animated.View style={{ width: 8, height: 18, backgroundColor: AM.amber, marginLeft: 2, opacity: caretOp }} />
          )}
        </View>
      </View>

      {/* Thinking phase */}
      {phase === 'thinking' && (
        <View style={styles.thinkBlock}>
          <View style={{ width: 80, height: 80 }}>
            <SpinningRecord size={80} period={2400} tonearm={false} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.thinkKicker}>PULLING A RECORD</Text>
            <Text style={styles.thinkText}>
              "Hmm. Domestic, upbeat but not perky. Give me a second."
            </Text>
          </View>
        </View>
      )}

      {/* Result phase */}
      {phase === 'result' && (
        <Animated.View style={{ opacity: cardOpacity, marginTop: Space.s22 }}>
          <View style={styles.resultCard}>
            <Tick pos="tl" color={AM.amber} bg={AM.bg} />
            <Tick pos="tr" color={AM.amber} bg={AM.bg} />
            <Tick pos="bl" color={AM.amber} bg={AM.bg} />
            <Tick pos="br" color={AM.amber} bg={AM.bg} />
            <SleeveArt title="Mind Tricks" artist="Tom Ze" size={96} variant={1} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.resultKicker}>LP / 042 · SIDE B</Text>
              <Text style={styles.resultTitle}>
                Tom Zé — <Text style={{ color: AM.amber }}>Jimmy, Renda-se</Text>
              </Text>
              <Text style={styles.resultBlurb}>
                "Brazilian polyrhythm. Keeps your hips moving{'\n'}without asking anything of your brain."
              </Text>
            </View>
          </View>
        </Animated.View>
      )}

      <View style={{ flex: 1 }} />

      <Text style={styles.askFooter}>
        Mood, moment, memory — anything works. Try <Text style={styles.askFooterInline}>&ldquo;after a hard day&rdquo;</Text>,
        <Text style={styles.askFooterInline}> &ldquo;something my dad would&rsquo;ve liked&rdquo;</Text>, or just a feeling.
      </Text>
    </View>
  );
}

// ─────────────── Frame 04 · BEGIN ───────────────

function FrameBegin() {
  return (
    <View style={styles.frame}>
      <View style={styles.beginRecord}>
        <View style={{ position: 'absolute', right: 0, top: 0 }}>
          <SpinningRecord size={170} period={6000} tonearm={false} />
        </View>
        <View style={[styles.beginSleeve, { shadowColor: AM.bgDeep }]}>
          <SleeveArt title="The Garden" artist="Francis Bebey" size={150} variant={2} />
        </View>
        {/* Static tonearm */}
        <View style={styles.beginArm} />
      </View>

      <View style={[styles.copyBlock, { marginTop: Space.s26 }]}>
        <Text style={styles.copyKicker}>QUEUED UP · TONIGHT&rsquo;S BROADCAST</Text>
        <Text style={styles.copyHeadline}>
          The set starts{'\n'}when you do.
        </Text>
        <Text style={styles.copyTagline}>
          Drop the needle. ONAY will take it from here.
        </Text>
      </View>
    </View>
  );
}

// ─────────────── Styles ───────────────

const DIAL_SIZE = 280;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: Space.s20,
  },

  progressRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressTick: {
    flex: 1,
    height: 2,
  },
  progressLabels: {
    marginTop: Space.s10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressMono: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2,
  },

  frameWrap: {
    flex: 1,
    marginTop: Space.s22,
  },
  frame: {
    flex: 1,
  },

  // Dial
  dial: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    alignSelf: 'center',
    position: 'relative',
  },
  needleAnchor: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
  },
  needleBar: {
    position: 'absolute',
    bottom: 0,
    left: -1,
    width: 2,
    height: 130,
    backgroundColor: AM.amber,
    shadowColor: AM.amber,
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  dialLabel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialLocked: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.amberDim,
    letterSpacing: 3,
  },
  dialOnay: {
    marginTop: 4,
    fontFamily: Fonts.display,
    fontSize: 36,
    color: AM.ink,
    letterSpacing: 1,
    lineHeight: 32,
  },
  dialFreq: {
    marginTop: 4,
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.amber,
    letterSpacing: 2,
  },

  // Crate
  crate: {
    position: 'relative',
    height: 180,
    alignSelf: 'stretch',
  },
  tonightStamp: {
    position: 'absolute',
    left: '50%',
    top: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: AM.oxblood,
    zIndex: 10,
    shadowColor: AM.bgDeep,
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  tonightStampText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.cream,
    letterSpacing: 3,
  },
  linerExcerpt: {
    marginTop: Space.s22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderLeftWidth: 2,
    borderLeftColor: AM.oxblood,
  },
  linerKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.oxblood,
    letterSpacing: 2.5,
  },
  linerBody: {
    marginTop: 6,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 13,
    color: AM.inkMid,
    lineHeight: 19,
  },

  // Ask
  askKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amberDim,
    letterSpacing: 3,
  },
  askHeadline: {
    marginTop: 8,
    fontFamily: Fonts.display,
    fontSize: 28,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 28,
  },
  askField: {
    marginTop: Space.s22,
    padding: 12,
    borderWidth: 1,
    borderColor: AM.amberDim,
    position: 'relative',
  },
  askFieldLabel: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.inkDim,
    letterSpacing: 2.5,
    marginBottom: 6,
  },
  askFieldText: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 16,
    color: AM.ink,
    lineHeight: 20,
  },
  thinkBlock: {
    marginTop: Space.s22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  thinkKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amberDim,
    letterSpacing: 2.5,
  },
  thinkText: {
    marginTop: 6,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 13,
    color: AM.inkMid,
    lineHeight: 18,
  },
  resultCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: AM.amberDim,
    padding: 14,
    position: 'relative',
  },
  resultKicker: {
    fontFamily: Fonts.mono,
    fontSize: 8,
    color: AM.amberDim,
    letterSpacing: 2.5,
  },
  resultTitle: {
    marginTop: 4,
    fontFamily: Fonts.display,
    fontSize: 20,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 20,
  },
  resultBlurb: {
    marginTop: 8,
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 13,
    color: AM.inkMid,
    lineHeight: 18,
  },
  askFooter: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 13,
    color: AM.inkMid,
    lineHeight: 19,
  },
  askFooterInline: {
    fontFamily: Fonts.mono,
    fontStyle: 'normal',
    fontSize: 11,
    color: AM.amber,
    letterSpacing: 1,
  },

  // Begin
  beginRecord: {
    marginTop: Space.s22,
    alignSelf: 'center',
    width: 280,
    height: 180,
    position: 'relative',
  },
  beginSleeve: {
    position: 'absolute',
    left: 0, top: 14,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  beginArm: {
    position: 'absolute',
    top: -4, right: -4,
    width: 90, height: 3,
    backgroundColor: AM.amber,
    transformOrigin: 'right center',
    transform: [{ rotate: '-18deg' }],
  },

  // Shared copy
  copyBlock: {
    marginTop: Space.s22,
    gap: Space.s12,
  },
  copyKicker: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.amberDim,
    letterSpacing: 3,
    textAlign: 'center',
  },
  copyHeadline: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: AM.ink,
    letterSpacing: 0.5,
    lineHeight: 30,
    textAlign: 'center',
  },
  copyTagline: {
    fontFamily: Fonts.serif,
    fontStyle: 'italic',
    fontSize: 14,
    color: AM.inkMid,
    lineHeight: 21,
    textAlign: 'center',
  },

  // Footer
  footer: {
    paddingTop: Space.s14,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  footerSide: {
    width: 60,
  },
  footerBack: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: AM.inkDim,
    letterSpacing: 2.5,
  },
  next: {
    flex: 1,
  },
  nextAmber: {
    position: 'relative',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: AM.amber,
    alignItems: 'center',
  },
  nextAmberText: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: AM.amber,
    letterSpacing: 2,
  },
  nextOxblood: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: AM.oxblood,
    alignItems: 'center',
    shadowColor: AM.bgDeep,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  nextOxbloodText: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: AM.cream,
    letterSpacing: 2,
  },

  skip: {
    marginTop: Space.s12,
    alignItems: 'center',
  },
  skipText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: AM.inkDim,
    letterSpacing: 2,
    textDecorationLine: 'underline',
  },
});
