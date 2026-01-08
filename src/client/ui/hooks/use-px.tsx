import { useScale } from "./use-scale";

/**
 * @warn please use `ScalerContext` to make this work
 */
export function usePx(): UIScaler.СalculatorApi {
	return useScale().usePx();
}
