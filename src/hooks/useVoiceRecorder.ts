import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { AIService } from '../services/ai';

const aiService = new AIService();

// Grava até esse limite e transcreve automaticamente, para manter o
// áudio (em base64) dentro do limite de body do backend (15mb).
const MAX_RECORDING_MS = 120_000;

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const autoStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoStop = () => {
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Permissão necessária', 'Precisamos acessar o microfone para gravar sua voz.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    autoStopTimer.current = setTimeout(() => {
      stopRecordingAndTranscribe();
    }, MAX_RECORDING_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const stopRecordingAndTranscribe = useCallback(async (): Promise<string | null> => {
    clearAutoStop();
    if (!recorderState.isRecording) return null;

    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return null;

    setIsTranscribing(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const text = await aiService.transcribeAudio(base64, 'audio/m4a');
      if (!text) {
        Alert.alert('Não entendi', 'Não conseguimos transcrever esse áudio. Tente falar de novo, mais perto do microfone.');
        return null;
      }
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao transcrever áudio';
      Alert.alert('Erro na transcrição', message);
      return null;
    } finally {
      setIsTranscribing(false);
    }
  }, [recorder, recorderState.isRecording]);

  const cancelRecording = useCallback(async () => {
    clearAutoStop();
    if (recorderState.isRecording) {
      await recorder.stop();
    }
  }, [recorder, recorderState.isRecording]);

  return {
    isRecording: recorderState.isRecording,
    isTranscribing,
    durationMillis: recorderState.durationMillis ?? 0,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
  };
}
