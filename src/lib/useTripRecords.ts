import { useCallback, useEffect, useState } from 'react'
import { getByTrip } from '../db/db'
import type { DataStoreName, StoreRecordMap } from '../types'

type ChildStore = Exclude<DataStoreName, 'trips'>

/** 讀取某趟旅行底下某一類資料，並提供重新讀取的函式 */
export function useTripRecords<K extends ChildStore>(store: K, tripId: string | undefined) {
  const [records, setRecords] = useState<StoreRecordMap[K][]>([])

  const reload = useCallback(async () => {
    setRecords(tripId ? await getByTrip(store, tripId) : [])
  }, [store, tripId])

  useEffect(() => {
    let alive = true
    ;(tripId ? getByTrip(store, tripId) : Promise.resolve([])).then((r) => {
      if (alive) setRecords(r as StoreRecordMap[K][])
    })
    return () => {
      alive = false
    }
  }, [store, tripId])

  return [records, reload] as const
}
