import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Colors,
  Surface,
  TextColors,
  Typography,
  Glow,
  Gradient,
  Spacing,
  Radius,
  withAlpha,
} from '../../tokens/design-tokens';
import { CleoOrb } from '../../components/CleoOrb';
import { getUser, setUser } from '../../services/Storage';

const MOODS = [
  { key: 'focused', label: 'Focused', icon: '🎯' },
  { key: 'energetic', label: 'Energetic', icon: '⚡' },
  { key: 'mellow', label: 'Mellow', icon: '🌙' },
] as const;

const GOALS = [
  { key: 'discovery', label: 'Discovery', description: 'Find hidden gems and new artists' },
  { key: 'relaxation', label: 'Relaxation', description: 'Ambient textures and calm soundscapes' },
  { key: 'work', label: 'Work', description: 'Deep beats for high productivity' },
] as const;

const GENRES = [
  'Electronic',
  'Neo-Jazz',
  'Lo-Fi',
  'Ambient',
  'Cinematic',
  'Trip-Hop',
] as const;

export function CleoOnboarding() {
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };

  const saveAndNavigate = () => {
    const existing = getUser();
    setUser({
      ...existing,
      appleMusicAuthorized: existing?.appleMusicAuthorized ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      onboardingMood: selectedMood ?? undefined,
      onboardingGoal: selectedGoal ?? undefined,
      onboardingGenres: selectedGenres.length > 0 ? selectedGenres : undefined,
    } as any);
    router.replace('/(main)');
  };

  const skipAndNavigate = () => {
    const existing = getUser();
    setUser({
      ...existing,
      appleMusicAuthorized: existing?.appleMusicAuthorized ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    } as any);
    router.replace('/(main)');
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Cleo Orb */}
      <View style={styles.orbContainer}>
        <CleoOrb size={64} showGlow />
      </View>

      {/* Greeting */}
      <Text style={styles.greeting}>
        {'\u201C'}Hello, I'm <Text style={styles.cleoName}>ONAY.</Text>{'\u201D'}
      </Text>
      <Text style={styles.subtext}>
        Your personal AI radio host. I curate frequencies that match your soul's current wavelength. How are we feeling today?
      </Text>

      {/* Current Mood */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CURRENT MOOD</Text>
        <View style={styles.moodRow}>
          {MOODS.map((mood) => {
            const isSelected = selectedMood === mood.key;
            return (
              <Pressable
                key={mood.key}
                style={styles.moodCardWrapper}
                onPress={() => setSelectedMood(isSelected ? null : mood.key)}
                accessibilityLabel={`${mood.label} mood${isSelected ? ', selected' : ''}`}
                accessibilityRole="button"
              >
                <View style={[styles.moodCard, isSelected && styles.moodCardSelected]}>
                  <View style={[styles.moodIconCircle, isSelected && styles.moodIconCircleSelected]}>
                    <Text style={styles.moodIcon}>{mood.icon}</Text>
                  </View>
                  <Text style={[styles.moodLabel, isSelected && styles.moodLabelSelected]}>
                    {mood.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Session Goal */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SESSION GOAL</Text>
        {GOALS.map((goal) => {
          const isSelected = selectedGoal === goal.key;
          return (
            <Pressable
              key={goal.key}
              onPress={() => setSelectedGoal(isSelected ? null : goal.key)}
              accessibilityLabel={`${goal.label}: ${goal.description}${isSelected ? ', selected' : ''}`}
              accessibilityRole="radio"
            >
              <View style={[styles.goalCard, isSelected && styles.goalCardSelected]}>
                <View style={styles.goalTextContainer}>
                  <Text style={[styles.goalLabel, isSelected && styles.goalLabelSelected]}>
                    {goal.label}
                  </Text>
                  <Text style={styles.goalDescription}>{goal.description}</Text>
                </View>
                <View style={[styles.radio, isSelected && styles.radioSelected]}>
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Genre Palette */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>GENRE PALETTE</Text>
        <View style={styles.genreWrap}>
          {GENRES.map((genre) => {
            const isSelected = selectedGenres.includes(genre);
            return (
              <Pressable
                key={genre}
                onPress={() => toggleGenre(genre)}
                accessibilityLabel={`${genre}${selectedGenres.includes(genre) ? ', selected' : ''}`}
                accessibilityRole="button"
              >
                <View style={[styles.genrePill, isSelected && styles.genrePillSelected]}>
                  <Text style={[styles.genreText, isSelected && styles.genreTextSelected]}>
                    {genre}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* CTA Button */}
      <Pressable
        onPress={saveAndNavigate}
        style={({ pressed }) => [styles.ctaWrapper, pressed && { opacity: 0.7 }]}
        accessibilityLabel="Start my broadcast"
        accessibilityRole="button"
      >
        <LinearGradient
          colors={Gradient.cta.colors as unknown as [string, string]}
          start={Gradient.cta.start}
          end={Gradient.cta.end}
          style={styles.ctaButton}
        >
          <Text style={styles.ctaText}>Start My Broadcast</Text>
          <Text style={styles.ctaArrow}>{' \u25B6'}</Text>
        </LinearGradient>
      </Pressable>

      {/* Skip link */}
      <Pressable onPress={skipAndNavigate} style={styles.skipWrapper} accessibilityLabel="Skip setup" accessibilityRole="button">
        <Text style={styles.skipText}>Skip setup, surprise me</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: Surface.base,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: 80,
    paddingBottom: Spacing.xxl,
    alignItems: 'center',
  },
  orbContainer: {
    marginBottom: Spacing.lg,
    alignItems: 'center',
  },
  greeting: {
    fontFamily: Typography.cleoVoice.family,
    fontStyle: 'italic',
    fontSize: 28,
    color: TextColors.primary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  cleoName: {
    color: Colors.accent,
  },
  subtext: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
  },
  section: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    fontFamily: Typography.mono.family,
    fontSize: 10,
    letterSpacing: 2.5,
    color: TextColors.outline,
    marginBottom: Spacing.md,
  },

  // Mood cards - circular icon style matching Stitch
  moodRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  moodCardWrapper: {
    flex: 1,
  },
  moodCard: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Surface.container,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  moodCardSelected: {
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Colors.accent, 0.08),
  },
  moodIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Surface.high,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  moodIconCircleSelected: {
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Colors.accent, 0.12),
  },
  moodIcon: {
    fontSize: 22,
  },
  moodLabel: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 13,
    color: TextColors.secondary,
  },
  moodLabelSelected: {
    color: TextColors.primary,
  },

  // Goal rows
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Surface.container,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  goalCardSelected: {
    borderColor: Colors.accent,
    backgroundColor: withAlpha(Colors.accent, 0.08),
  },
  goalTextContainer: {
    flex: 1,
  },
  goalLabel: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 15,
    color: TextColors.primary,
    marginBottom: 2,
  },
  goalLabelSelected: {
    color: Colors.accent,
  },
  goalDescription: {
    fontFamily: Typography.body.family,
    fontSize: 13,
    color: TextColors.outline,
    lineHeight: 18,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: TextColors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.sm,
  },
  radioSelected: {
    borderColor: Colors.accent,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.accent,
  },

  // Genre pills
  genreWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  genrePill: {
    backgroundColor: Surface.high,
    borderWidth: 1,
    borderColor: TextColors.outlineVariant,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  genrePillSelected: {
    backgroundColor: withAlpha(Colors.accent, 0.15),
    borderColor: Colors.accent,
  },
  genreText: {
    fontFamily: Typography.body.familyMedium,
    fontSize: 13,
    color: TextColors.secondary,
  },
  genreTextSelected: {
    color: Colors.accent,
  },

  // CTA
  ctaWrapper: {
    width: '100%',
    marginTop: Spacing.lg,
    ...Glow.ctaShadow,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.full,
  },
  ctaText: {
    fontFamily: Typography.body.familySemiBold,
    fontSize: 16,
    color: Colors.base.white,
  },
  ctaArrow: {
    fontSize: 14,
    color: Colors.base.white,
  },

  // Skip
  skipWrapper: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  skipText: {
    fontFamily: Typography.body.family,
    fontSize: 14,
    color: TextColors.secondary,
  },
});
