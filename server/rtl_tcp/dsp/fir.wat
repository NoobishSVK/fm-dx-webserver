;; Folded, decimating low-pass FIR for the L+R and L-R channels.
;;
;; This is the inner loop of FmStereoDecoder._decimate() with 128-bit SIMD.
;; Lane 0 of each accumulator is the JavaScript "even" accumulator and lane 1
;; the "odd" one, and every lane performs the same IEEE double operations in
;; the same order, so the output is bit-identical to the JavaScript loop.
;;
;; Rebuild server/rtl_tcp/dsp/fir-wasm.js after editing:
;;   node server/rtl_tcp/dsp/build-fir-wasm.js
(module
  (import "env" "memory" (memory 1))

  ;; For start = first, first + decimation, ... < count, writes
  ;;   out[2k] = sum of taps over sum[start .. start + 2 * middle]
  ;;   out[2k + 1] = the same over diff (0 when diff is silent from start on)
  ;; and returns the number of outputs. Addresses are byte offsets.
  (func (export "fir")
    (param $sum i32) (param $diff i32) (param $taps i32) (param $out i32)
    (param $first i32) (param $count i32) (param $decimation i32)
    (param $lastActiveDiff i32) (param $middle i32)
    (result i32)
    (local $start i32) (local $outputs i32) (local $tap i32) (local $paired i32)
    (local $oldest i32) (local $newest i32) (local $coefficient i32)
    (local $diffOffset i32) (local $middleBytes i32) (local $spanBytes i32)
    (local $sumAccumulator v128) (local $diffAccumulator v128) (local $taps2 v128)
    (local $centreTap f64) (local $sumEven f64) (local $diffEven f64)
    (local $sumValue f64) (local $diffValue f64)

    (local.set $paired (i32.and (local.get $middle) (i32.const -2)))
    (local.set $middleBytes (i32.shl (local.get $middle) (i32.const 3)))
    (local.set $spanBytes (i32.shl (local.get $middle) (i32.const 4)))
    (local.set $diffOffset (i32.sub (local.get $diff) (local.get $sum)))
    (local.set $centreTap
      (f64.load (i32.add (local.get $taps) (local.get $middleBytes))))
    (local.set $start (local.get $first))

    (block $done
      (loop $nextOutput
        (br_if $done (i32.ge_s (local.get $start) (local.get $count)))

        ;; oldest -> work[start + tap]; newest -> work[start + span - tap - 1],
        ;; so one unaligned load at newest gives [work[n - 1], work[n]].
        (local.set $oldest
          (i32.add (local.get $sum) (i32.shl (local.get $start) (i32.const 3))))
        (local.set $newest
          (i32.sub (i32.add (local.get $oldest) (local.get $spanBytes)) (i32.const 8)))
        (local.set $coefficient (local.get $taps))
        (local.set $tap (i32.const 0))

        (local.set $sumAccumulator
          (f64x2.replace_lane 0 (v128.const f64x2 0 0)
            (f64.mul
              (f64.load (i32.add (local.get $oldest) (local.get $middleBytes)))
              (local.get $centreTap))))

        (if (i32.ge_s (local.get $lastActiveDiff) (local.get $start))
          (then
            (local.set $diffAccumulator
              (f64x2.replace_lane 0 (v128.const f64x2 0 0)
                (f64.mul
                  (f64.load
                    (i32.add
                      (i32.add (local.get $oldest) (local.get $diffOffset))
                      (local.get $middleBytes)))
                  (local.get $centreTap))))

            (block $pairsDone
              (loop $pairs
                (br_if $pairsDone (i32.ge_s (local.get $tap) (local.get $paired)))
                (local.set $taps2 (v128.load (local.get $coefficient)))
                (local.set $sumAccumulator
                  (f64x2.add (local.get $sumAccumulator)
                    (f64x2.mul
                      (f64x2.add
                        (v128.load (local.get $oldest))
                        (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7
                          (v128.load (local.get $newest))
                          (v128.load (local.get $newest))))
                      (local.get $taps2))))
                (local.set $diffAccumulator
                  (f64x2.add (local.get $diffAccumulator)
                    (f64x2.mul
                      (f64x2.add
                        (v128.load (i32.add (local.get $oldest) (local.get $diffOffset)))
                        (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7
                          (v128.load (i32.add (local.get $newest) (local.get $diffOffset)))
                          (v128.load (i32.add (local.get $newest) (local.get $diffOffset)))))
                      (local.get $taps2))))
                (local.set $oldest (i32.add (local.get $oldest) (i32.const 16)))
                (local.set $newest (i32.sub (local.get $newest) (i32.const 16)))
                (local.set $coefficient (i32.add (local.get $coefficient) (i32.const 16)))
                (local.set $tap (i32.add (local.get $tap) (i32.const 2)))
                (br $pairs)))

            (local.set $sumEven (f64x2.extract_lane 0 (local.get $sumAccumulator)))
            (local.set $diffEven (f64x2.extract_lane 0 (local.get $diffAccumulator)))
            ;; Odd middle: the last unpaired tap joins the even accumulators.
            (block $tailDone
              (loop $tail
                (br_if $tailDone (i32.ge_s (local.get $tap) (local.get $middle)))
                (local.set $sumEven
                  (f64.add (local.get $sumEven)
                    (f64.mul
                      (f64.add
                        (f64.load (local.get $oldest))
                        (f64.load (i32.add (local.get $newest) (i32.const 8))))
                      (f64.load (local.get $coefficient)))))
                (local.set $diffEven
                  (f64.add (local.get $diffEven)
                    (f64.mul
                      (f64.add
                        (f64.load (i32.add (local.get $oldest) (local.get $diffOffset)))
                        (f64.load
                          (i32.add
                            (i32.add (local.get $newest) (local.get $diffOffset))
                            (i32.const 8))))
                      (f64.load (local.get $coefficient)))))
                (local.set $oldest (i32.add (local.get $oldest) (i32.const 8)))
                (local.set $newest (i32.sub (local.get $newest) (i32.const 8)))
                (local.set $coefficient (i32.add (local.get $coefficient) (i32.const 8)))
                (local.set $tap (i32.add (local.get $tap) (i32.const 1)))
                (br $tail)))
            (local.set $sumValue
              (f64.add (local.get $sumEven)
                (f64x2.extract_lane 1 (local.get $sumAccumulator))))
            (local.set $diffValue
              (f64.add (local.get $diffEven)
                (f64x2.extract_lane 1 (local.get $diffAccumulator)))))
          (else
            (block $pairsDone
              (loop $pairs
                (br_if $pairsDone (i32.ge_s (local.get $tap) (local.get $paired)))
                (local.set $sumAccumulator
                  (f64x2.add (local.get $sumAccumulator)
                    (f64x2.mul
                      (f64x2.add
                        (v128.load (local.get $oldest))
                        (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7
                          (v128.load (local.get $newest))
                          (v128.load (local.get $newest))))
                      (v128.load (local.get $coefficient)))))
                (local.set $oldest (i32.add (local.get $oldest) (i32.const 16)))
                (local.set $newest (i32.sub (local.get $newest) (i32.const 16)))
                (local.set $coefficient (i32.add (local.get $coefficient) (i32.const 16)))
                (local.set $tap (i32.add (local.get $tap) (i32.const 2)))
                (br $pairs)))

            (local.set $sumEven (f64x2.extract_lane 0 (local.get $sumAccumulator)))
            (block $tailDone
              (loop $tail
                (br_if $tailDone (i32.ge_s (local.get $tap) (local.get $middle)))
                (local.set $sumEven
                  (f64.add (local.get $sumEven)
                    (f64.mul
                      (f64.add
                        (f64.load (local.get $oldest))
                        (f64.load (i32.add (local.get $newest) (i32.const 8))))
                      (f64.load (local.get $coefficient)))))
                (local.set $oldest (i32.add (local.get $oldest) (i32.const 8)))
                (local.set $newest (i32.sub (local.get $newest) (i32.const 8)))
                (local.set $coefficient (i32.add (local.get $coefficient) (i32.const 8)))
                (local.set $tap (i32.add (local.get $tap) (i32.const 1)))
                (br $tail)))
            (local.set $sumValue
              (f64.add (local.get $sumEven)
                (f64x2.extract_lane 1 (local.get $sumAccumulator))))
            ;; JavaScript: diffEven + diffOdd with both still zero.
            (local.set $diffValue (f64.const 0))))

        (f64.store
          (i32.add (local.get $out) (i32.shl (local.get $outputs) (i32.const 4)))
          (local.get $sumValue))
        (f64.store offset=8
          (i32.add (local.get $out) (i32.shl (local.get $outputs) (i32.const 4)))
          (local.get $diffValue))
        (local.set $outputs (i32.add (local.get $outputs) (i32.const 1)))
        (local.set $start (i32.add (local.get $start) (local.get $decimation)))
        (br $nextOutput)))

    (local.get $outputs)))
