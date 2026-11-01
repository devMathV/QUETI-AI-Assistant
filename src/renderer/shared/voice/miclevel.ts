import { mapMicError, openMicrophone } from './recorder'

// Teste de nível do microfone: mede o volume (em dBFS) por alguns segundos, no próprio
// computador. Nada é gravado nem enviado; o microfone é liberado ao terminar.

export interface MicTestResult {
  /** Volume mais alto medido (voz), em dB abaixo do máximo digital (0 = máximo). */
  voiceDb: number
  /** Nível típico do ruído de fundo (os momentos mais silenciosos), em dB. */
  noiseDb: number
}

export async function runMicTest(
  deviceId: string,
  durationMs: number,
  onLevel: (db: number) => void,
  autoGain = true
): Promise<MicTestResult> {
  let stream: MediaStream
  try {
    stream = await openMicrophone(deviceId, autoGain)
  } catch (error) {
    throw mapMicError(error)
  }
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  context.createMediaStreamSource(stream).connect(analyser)
  const buffer = new Float32Array(analyser.fftSize)
  const samples: number[] = []

  await new Promise<void>((resolve) => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const v of buffer) sum += v * v
      const db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / buffer.length) || 1e-5))
      samples.push(db)
      onLevel(db)
      if (Date.now() - started >= durationMs) {
        window.clearInterval(timer)
        resolve()
      }
    }, 50)
  })

  stream.getTracks().forEach((t) => t.stop()) // libera o microfone
  void context.close()
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    voiceDb: Math.round(sorted[sorted.length - 1] ?? -100),
    noiseDb: Math.round(sorted[Math.floor(sorted.length * 0.2)] ?? -100)
  }
}

/** Interpreta o resultado e diz o que fazer. */
export function describeMicTest(r: MicTestResult): { ok: boolean; text: string } {
  const numbers = `Sua voz chegou a ${r.voiceDb} dB e o ruído de fundo ficou perto de ${r.noiseDb} dB.`
  if (r.voiceDb < -40) {
    return { ok: false, text: `${numbers} O volume está muito baixo: aproxime-se do microfone ou aumente o volume de entrada no Windows (Configurações → Sistema → Som → Entrada).` }
  }
  if (r.voiceDb > -8) {
    return { ok: false, text: `${numbers} O sinal está muito alto e pode distorcer: afaste-se do microfone ou diminua o volume de entrada no Windows.` }
  }
  if (r.noiseDb > -40 || r.voiceDb - r.noiseDb < 20) {
    return { ok: false, text: `${numbers} Há muito ruído de fundo em relação à sua voz, o que atrapalha a transcrição. Tente um ambiente mais silencioso ou um headset.` }
  }
  return { ok: true, text: `${numbers} Boa qualidade para transcrição.` }
}
