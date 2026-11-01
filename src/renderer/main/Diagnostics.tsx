import { useEffect, useState } from 'react'
import type { Diagnostics as DiagnosticsData } from '../../shared/types'

const TYPE_LABEL: Record<string, string> = {
  Browser: 'Processo principal',
  Tab: 'Janela (interface)',
  GPU: 'Gráfico (GPU)',
  Utility: 'Utilitário'
}

export default function Diagnostics() {
  const [data, setData] = useState<DiagnosticsData | null>(null)

  // Medição apenas sob demanda: sem atualização automática, para não consumir recursos.
  const refresh = () => void window.api.diagnostics.get().then(setData)
  useEffect(refresh, [])

  return (
    <div className="page">
      <h2>Diagnóstico</h2>
      <p className="hint">
        Valores medidos agora pelo próprio Electron. A CPU mostra o uso desde a medição anterior; clique em Atualizar duas vezes para ver um valor mais representativo.
      </p>
      <p>
        <button type="button" className="text-btn" onClick={refresh}>
          Atualizar
        </button>
      </p>

      {data && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Processo</th>
                  <th scope="col">Memória (MB)</th>
                  <th scope="col">CPU (%)</th>
                </tr>
              </thead>
              <tbody>
                {data.processes.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name || TYPE_LABEL[p.type] || p.type}</td>
                    <td>{p.memoryMB}</td>
                    <td>{p.cpuPercent}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td>{data.totalMemoryMB}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="hint">
            Versão {data.appVersion} · Electron {data.electron} · Chromium {data.chrome} · Node {data.node}
          </p>
        </>
      )}
    </div>
  )
}
