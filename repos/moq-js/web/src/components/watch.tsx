/* eslint-disable jsx-a11y/media-has-caption */
import { Player } from "@kixelated/moq/playback"

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"

export default function Watch(props: { name: string }) {
	// Use query params to allow overriding environment variables.
	const urlSearchParams = new URLSearchParams(window.location.search)
	const params = Object.fromEntries(urlSearchParams.entries())
	const server = params.server ?? import.meta.env.PUBLIC_RELAY_HOST

	const [error, setError] = createSignal<Error | undefined>()

	let canvas!: HTMLCanvasElement

	const [usePlayer, setPlayer] = createSignal<Player | undefined>()
	const [showCatalog, setShowCatalog] = createSignal(false)
	const [volume, setVolume] = createSignal(50)

	createEffect(() => {
		const namespace = props.name
		const url = `https://${server}`

		// Special case localhost to fetch the TLS fingerprint from the server.
		// TODO remove this when WebTransport correctly supports self-signed certificates
		const fingerprint = server.startsWith("localhost") ? `https://${server}/fingerprint` : undefined

		Player.create({ url, fingerprint, canvas, namespace }).then(setPlayer).catch(setError)
	})

	const changeVolume = (event: Event) => {
		const volumeValue = (event.target as HTMLInputElement).value
		setVolume(Number(volumeValue)) // Update the signal
		usePlayer()?.setVolume(Number(volumeValue) / 100) // Adjust the player's volume
	}

	createEffect(() => {
		const player = usePlayer()
		if (!player) return

		onCleanup(() => player.close())
		player.closed().then(setError).catch(setError)
	})

	const play = () => {
		usePlayer()?.play().catch(setError)
	}

	const pause = () => {
		usePlayer()?.pause().catch(setError);
	};

	const handleContinue = () => {
		usePlayer()?.resubscribe().catch(setError);
	  };

	// The JSON catalog for debugging.
	const catalog = createMemo(() => {
		const player = usePlayer()
		if (!player) return

		const catalog = player.getCatalog()
		return JSON.stringify(catalog, null, 2)
	})

	// NOTE: The canvas automatically has width/height set to the decoded video size.
	// TODO shrink it if needed via CSS
	return (
		<>
		  <canvas ref={canvas} onClick={play} />

		  <div class="volume-control">
			<label>Volume</label>
			<input
			  id="volume"
			  type="range"
			  min="0"
			  max="100"
			  value={volume()}
			  onInput={changeVolume}
			/>
		  </div>

		  <div class="controls">
			<button class="controls-button" onClick={pause}>Pause</button>
		  </div>

		  <div class="controls">
			<button class="controls-button" onClick={handleContinue}>Continue</button>
		  </div>
		</>
	  )
}
