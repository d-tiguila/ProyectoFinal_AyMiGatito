// Importar librerías necesarias
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import GUI from 'lil-gui'
import CANNON from 'cannon'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AnimationMixer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SpeedInsights } from "@vercel/speed-insights/next"



let catBoxBody
let catBoxBody2
let statusShadowCat1, statusShadowCat2
let catGroup1, catGroup2
let scoreCat1 = 0
let scoreCat2 = 0
let scoreDisplayCat1, scoreDisplayCat2
let timeRemaining = 90 // in seconds
let timerInterval = null
let gameEnded = false




const red = new THREE.Color(0xff0000)
const green = new THREE.Color(0x00ff00)
const catchDistance = 1.0

red.convertSRGBToLinear()
green.convertSRGBToLinear()


const PixelShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        pixelSize: { value: 4.0 }
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float pixelSize;
        varying vec2 vUv;
        void main() {
            vec2 dxy = pixelSize / resolution;
            vec2 coord = dxy * floor(vUv / dxy);
            gl_FragColor = texture2D(tDiffuse, coord);
        }
    `
}



//  Contact tracker 
function isCannonContact(bodyA, bodyB) {
    for (let i = 0; i < world.contacts.length; i++) {
        const contact = world.contacts[i]
        if (
            (contact.bi === bodyA && contact.bj === bodyB) ||
            (contact.bi === bodyB && contact.bj === bodyA)
        ) {
            return true
        }
    }
    return false
}


// coallition tracker 

function isFishOnCatchTrajectory(fishBody, catBody) {
    const velocity = fishBody.velocity
    const position = fishBody.position

    if (velocity.y >= -0.1) return false // Not falling

    // 🟡 Compute actual floor center in world space (including rotation)
    const floorCenter = new CANNON.Vec3()
    catBody.pointToWorldFrame(new CANNON.Vec3(0, 0, 1.08), floorCenter)

    const dy = (position.y - fishBody.shapes[0].halfExtents.y) - floorCenter.y
    const timeToImpact = dy / -velocity.y

    if (timeToImpact < 0 || timeToImpact > 3) return false // too far or already past

    // Projected fish position
    const projectedX = position.x + velocity.x * timeToImpact
    const projectedZ = position.z + velocity.z * timeToImpact

    // Dimensions of the floor box
    const halfWidth = 0.4
    const halfDepth = 0.665

    const withinX = projectedX >= floorCenter.x - halfWidth && projectedX <= floorCenter.x + halfWidth
    const withinZ = projectedZ >= floorCenter.z - halfDepth && projectedZ <= floorCenter.z + halfDepth

    return withinX && withinZ
}


// score pop up
function createScorePopup(text, worldPosition) {
    const div = document.createElement('div')
    div.classList.add('score-popup')
    div.textContent = text
    document.body.appendChild(div)

    // Convert world position to screen space
    const projected = worldPosition.clone().project(camera)
    const x = (projected.x * 0.5 + 0.5) * sizes.width
    const y = (-projected.y * 0.5 + 0.5) * sizes.height
    div.style.left = `${x}px`
    div.style.top = `${y}px`

    // Animate with GSAP
    gsap.to(div, {
        y: '-40', // move up
        opacity: 1,
        duration: 0.2,
        ease: 'power2.out',
        onComplete: () => {
            gsap.to(div, {
                opacity: 0,
                duration: 0.5,
                delay: 0.3,
                onComplete: () => div.remove()
            })
        }
    })
}



// cambio sombra falsa de gato
function updateStatusShadow(catGroup, shadow, catBody) {
    const pivot = catGroup.getObjectByName('shadowPivot')
    if (pivot) {
        pivot.updateMatrixWorld()
        const worldPos = new THREE.Vector3()
        pivot.getWorldPosition(worldPos)
        shadow.position.set(worldPos.x, 0.02, worldPos.z)
    }

    let collided = false
    let onTrajectory = false

    for (let i = objectsToUpdate.length - 1; i >= 0; i--) {
        const entry = objectsToUpdate[i]
        const body = entry.body

        if (
            body.velocity.y < -0.1 &&
            isFishOnCatchTrajectory(body, catBody) &&
            isCannonContact(body, catBody)
        ) {
         
            // 🐟 Fish caught!
            collided = true
            shadow.lastCatchTime = performance.now()
        
            if (catBody === catBoxBody) {
                scoreCat1++
                const popupPos = new THREE.Vector3(catBody.position.x, catBody.position.y + 1.2, catBody.position.z)
                createScorePopup('+1', popupPos)
    
                console.log('Cat 1 score:', scoreCat1)
            } else if (catBody === catBoxBody2) {
                scoreCat2++
                const popupPos = new THREE.Vector3(catBody.position.x, catBody.position.y + 1.2, catBody.position.z)
                createScorePopup('+1', popupPos)
                console.log('Cat 2 score:', scoreCat2)
            }
        
            // Remove fish
            scene.remove(entry.mesh)
            scene.remove(entry.fakeShadow)
            world.removeBody(entry.body)
            objectsToUpdate.splice(i, 1)
            break
        }
        

        if (isFishOnCatchTrajectory(body, catBody)) {
            onTrajectory = true
        }
    }

    const now = performance.now()
    const timeSinceCatch = shadow.lastCatchTime !== null ? now - shadow.lastCatchTime : Infinity

if (timeSinceCatch < 500) {

        shadow.material.color.set(0x00ff00) // green stays ~1s
    } else if (onTrajectory) {
        shadow.material.color.set(0xffff00)
    } else {
        shadow.material.color.set(0xff0000)
    }
}





// Escena y canvas
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xb8f0ff) 

//  Peces callendo




// Configuración del mundo físico con Cannon.js
const world = new CANNON.World()
world.gravity.set(0, -9.82, 0)

const defaultMaterial = new CANNON.Material('default')
const defaultContactMaterial = new CANNON.ContactMaterial(defaultMaterial, defaultMaterial, {
    friction: 0.1,
    restitution: 0.08
})
world.addContactMaterial(defaultContactMaterial)
world.defaultContactMaterial = defaultContactMaterial

const stickyMaterial = new CANNON.Material('sticky')

const stickyContact = new CANNON.ContactMaterial(stickyMaterial, defaultMaterial, {
    friction: 0.8,      // High friction so fishes stop moving easily
    restitution: 0.1    // Low bounce
})
world.addContactMaterial(stickyContact)

// Plano físico para el suelo
const floorShape = new CANNON.Plane()
const floorBody = new CANNON.Body({ mass: 0 })
floorBody.addShape(floorShape)
floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(-1, 0, 0), Math.PI * 0.5)
world.addBody(floorBody)

// textura suelo
const textureLoader = new THREE.TextureLoader()
const floorTexture = textureLoader.load('/textures/floor.png')

floorTexture.wrapS = THREE.RepeatWrapping
floorTexture.wrapT = THREE.RepeatWrapping
floorTexture.repeat.set(30, 20)
floorTexture.encoding = THREE.sRGBEncoding


const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    color: new THREE.Color(0x8ffe7e), 
    roughness: 1,
    metalness: 0
})

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    floorMaterial
)
floor.rotation.x = -Math.PI * 0.5
floor.receiveShadow = true
scene.add(floor)


// Luces del entorno

// Luz ambiental blanca intensa
const ambientLight = new THREE.AmbientLight(0xffffff, 1)
scene.add(ambientLight)

// Luz direccional neutra muy brillante
const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5)
directionalLight.position.set(5, 10, 5)

directionalLight.castShadow = false
directionalLight.shadow.mapSize.set(1024, 1024)
directionalLight.shadow.camera.near = 1
directionalLight.shadow.camera.far = 20
directionalLight.shadow.camera.left = -10
directionalLight.shadow.camera.right = 10
directionalLight.shadow.camera.top = 10
directionalLight.shadow.camera.bottom = -10
scene.add(directionalLight)

// Luz hemisférica más fría para sombras azuladas
const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x88ccee, 0.8)
scene.add(hemisphereLight)


// Tamaño de pantalla y ajustes responsivos
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    const aspect = sizes.width / sizes.height
    camera.left = (-aspect * zoom) / 2
    camera.right = (aspect * zoom) / 2
    camera.top = zoom / 2
    camera.bottom = -zoom / 2
    camera.updateProjectionMatrix()

    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    composer.setSize(sizes.width, sizes.height)
    pixelPass.uniforms['resolution'].value.set(sizes.width, sizes.height)
    pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio)
    
})


// Cámara

// Calcular proporciones según la pantalla
const aspect = sizes.width / sizes.height
const zoom = 10

const camera = new THREE.OrthographicCamera(
    (-aspect * zoom) / 2,
    (aspect * zoom) / 2,
    zoom / 2,
    -zoom / 2,
    0.1,
    100
)

// Posicionar en ángulo isométrico
camera.position.set(0, 6, 10) // más baja y más de lado
camera.lookAt(0, 0, 0)

scene.add(camera)



const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.enableZoom = false


// Crear sombras falsas  para los gatos
function createStatusShadow(color = 0xff0000) {
    const geometry = new THREE.CircleGeometry(1, 32) // sombra más grande
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1.0,
        depthWrite: false
    })

    const shadow = new THREE.Mesh(geometry, material)
    shadow.rotation.x = -Math.PI * 0.5
    shadow.position.y = 0.02
    scene.add(shadow)
    return shadow
}

// Musica 
const listener = new THREE.AudioListener()
camera.add(listener) // 👂 Attach to camera so it follows the view

const backgroundSound = new THREE.Audio(listener)

const audioLoader = new THREE.AudioLoader()
audioLoader.load('/sounds/fondo.mp3', function (buffer) {
    backgroundSound.setBuffer(buffer)
    backgroundSound.setLoop(true)
    backgroundSound.setVolume(0.5)
})



// crear sombra false para peces

function createFakeShadow(position) {
    const shadowGeometry = new THREE.CircleGeometry(0.12, 32) // círculo liso
    const shadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
    })

    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
    shadow.rotation.x = -Math.PI * 0.5
    shadow.position.set(position.x, 0.01, position.z +1)
    scene.add(shadow)
    return shadow
}



// Renderer
const renderer = new THREE.WebGLRenderer({ canvas })
renderer.outputEncoding = THREE.sRGBEncoding
renderer.shadowMap.enabled = false
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputEncoding = THREE.sRGBEncoding

// post processing 
const composer = new EffectComposer(renderer)

const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const pixelPass = new ShaderPass(PixelShader)
pixelPass.uniforms['resolution'].value = new THREE.Vector2(window.innerWidth, window.innerHeight)
pixelPass.uniforms['resolution'].value.multiplyScalar(window.devicePixelRatio)
pixelPass.uniforms['pixelSize'].value = 3 


composer.addPass(pixelPass)

//bloom 

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.5,  // strength
    0.4,  // radius
    0.9  // threshold
)
composer.addPass(bloomPass)


//  Color grading






// Utilidad para crear cajas físicas y visuales
const objectsToUpdate = []
const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
const boxMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 1,
    flatShading: false // ✅ force smooth shading
  })
  
// peces callendo 
function createBox(width, height, depth, position) {
    if (!fishGLTF) return // Wait until model is loaded

    // 1. Clone the fish model
    const fishMesh = fishGLTF.clone(true)
    fishMesh.traverse(child => {
        if (child.isMesh) {
            child.castShadow = true
            child.receiveShadow = true
        }
    })

    // 2. Scale and position the fish
    fishMesh.scale.set(width*3, height*1.5, depth*7)
    const visualY = position.y + height / 2
    fishMesh.position.set(position.x, visualY, position.z)

    scene.add(fishMesh)

    // 3. Physics body (unchanged)
    const shape = new CANNON.Box(new CANNON.Vec3(width * 0.5, height * 0.7, depth * 0.5))
    const body = new CANNON.Body({
        mass: 1,
        position: new CANNON.Vec3(position.x, visualY, position.z),
        shape,
        material: defaultMaterial
    })

    world.addBody(body)

    const fakeShadow = createFakeShadow(position)

    // 4. Store for updates
    objectsToUpdate.push({ mesh: fishMesh, body, fakeShadow })
}


const fishLoader = new GLTFLoader()
let fishGLTF = null

fishLoader.load('/Models/pez.glb', (gltf) => {
    fishGLTF = gltf.scene
})




// Cargar modelo 3D del gato
let catModel = null
let catModel2 = null
let mixer = null
let allActions = []
let mixer2 = null
let allActions2 = []



// loader cat 1
const gltfLoader = new GLTFLoader()

gltfLoader.load('/Models/Cat_v6.glb', (gltf) => {
    gltf.scene.scale.set(1, 1, 1)
    gltf.scene.position.set(0, -0.1, 0)

    catModel = gltf.scene
    catGroup1 = new THREE.Group()
    catGroup1.add(catModel)
    const pivot1 = new THREE.Object3D()
pivot1.name = 'shadowPivot'
pivot1.position.set(0, -0.05, 1) // lo ajustamos luego si es necesario
catGroup1.add(pivot1)

    scene.add(catGroup1)

    statusShadowCat1 = createStatusShadow()
    scene.add(statusShadowCat1)
    statusShadowCat1.lastCatchTime = null

// debug box visible


    catBoxBody = new CANNON.Body({ mass: 1, material: defaultMaterial })
    catBoxBody.fixedRotation = true
    catBoxBody.updateMassProperties()

    catBoxBody.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.1, 0.665)), new CANNON.Vec3(0, 0.05, 1.08))
    catBoxBody.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.435, 0.665)), new CANNON.Vec3(-0.49, 0.435, 1.08))
    catBoxBody.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.435, 0.665)), new CANNON.Vec3(0.49, 0.435, 1.08))
    catBoxBody.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.435, 0.05)), new CANNON.Vec3(0, 0.435, 0.47))
    catBoxBody.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.435, 0.05)), new CANNON.Vec3(0, 0.435, 1.7))

    world.addBody(catBoxBody)

    mixer = new AnimationMixer(catModel)
    gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip)
        action.timeScale = 2.0
        action.play()
        action.paused = true
        allActions.push(action)
    })
})

// loader cat 2



    
const gltfLoader2 = new GLTFLoader()
gltfLoader2.load('/Models/Cat2_v1.glb', (gltf) => {
    const secondCat = gltf.scene.clone()
    secondCat.scale.set(1, 1, 1)
    secondCat.position.set(0, -0.1, 0) // el modelo en el centro del grupo

    catModel2 = secondCat
    catGroup2 = new THREE.Group()
    catGroup2.add(catModel2)

    // Pivote para la sombra
    const pivot2 = new THREE.Object3D()
    pivot2.name = 'shadowPivot'
    pivot2.position.set(0, -0.05, 1) // Igual que en el gato 1
    catGroup2.add(pivot2)

    // Mover todo el grupo a x = 2 para que todo empiece alineado
   // Match catGroup2’s visual start

    scene.add(catGroup2)

    // Sombra falsa (estado)
    statusShadowCat2 = createStatusShadow()
    scene.add(statusShadowCat2)

    statusShadowCat2.lastCatchTime = null


    //  debug Caja visible

    // Física de la caja
catBoxBody2 = new CANNON.Body({ mass: 1, material: defaultMaterial })
catBoxBody2.position.set(2, 0.05, 0) // igual que catBoxBody
catBoxBody2.fixedRotation = true
catBoxBody2.updateMassProperties()
    catBoxBody2.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.1, 0.665)), new CANNON.Vec3(0, 0.05, 1.08))
    catBoxBody2.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.435, 0.665)), new CANNON.Vec3(-0.49, 0.435, 1.08))
    catBoxBody2.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.435, 0.665)), new CANNON.Vec3(0.49, 0.435, 1.08))
    catBoxBody2.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.435, 0.05)), new CANNON.Vec3(0, 0.435, 0.47))
    catBoxBody2.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.435, 0.05)), new CANNON.Vec3(0, 0.435, 1.7))
    
    world.addBody(catBoxBody2)

    // Animación
    mixer2 = new AnimationMixer(catModel2)
    gltf.animations.forEach((clip) => {
        const action2 = mixer2.clipAction(clip)
        action2.timeScale = 2.0
        action2.play()
        action2.paused = true
        allActions2.push(action2)
    })
})




// Controles de movimiento del gato
const keysPressed = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false
}

window.addEventListener('keydown', (e) => {
    if (e.code in keysPressed) keysPressed[e.code] = true
})

window.addEventListener('keyup', (e) => {
    if (e.code in keysPressed) keysPressed[e.code] = false
})

window.addEventListener('click', () => {
    if (backgroundSound.buffer && !backgroundSound.isPlaying) {
        backgroundSound.play()
    }
}, { once: true }) // only need to trigger once



// Debug helper for Cat 1 floor collision area
// const cat1FloorAreaHelper = new THREE.Mesh(
//     new THREE.PlaneGeometry(0.8, 1.33), // same size as base
//     new THREE.MeshBasicMaterial({
//         color: 0xff00ff,
//         wireframe: true,
//         transparent: true,
//         opacity: 0.3
//     })
// )
// cat1FloorAreaHelper.rotation.x = -Math.PI * 0.5
// scene.add(cat1FloorAreaHelper)

// // Debug helper for Cat 2
// const cat2FloorAreaHelper = cat1FloorAreaHelper.clone()
// scene.add(cat2FloorAreaHelper)


// ⏱Animación
const clock = new THREE.Clock()
let oldElapsedTime = 0

const tick = () => {
    if (gameEnded) return

    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - oldElapsedTime
    oldElapsedTime = elapsedTime

    // 1. Actualizar físicas
    world.step(1 / 60, deltaTime,7)
    for (const { mesh, body, fakeShadow } of objectsToUpdate) {
        mesh.position.copy(body.position)
        mesh.quaternion.copy(body.quaternion)
        if (fakeShadow) {
            fakeShadow.position.set(body.position.x, 0.01, body.position.z
            )
        }
    }

   
    


    

    // 2. NUEVO movimiento del gato (reemplaza tu lógica anterior)
    
    if (catBoxBody && catGroup1) {
        const moveSpeed = 7
        const inputVector = new THREE.Vector3()
    
        if (keysPressed.ArrowUp) inputVector.z -= 1
        if (keysPressed.ArrowDown) inputVector.z += 1
        if (keysPressed.ArrowLeft) inputVector.x -= 1
        if (keysPressed.ArrowRight) inputVector.x += 1
    
        if (inputVector.lengthSq() > 0) {
            inputVector.normalize()
    
            // Apply to physics body
            catBoxBody.velocity.set(
                inputVector.x * moveSpeed,
                0,
                inputVector.z * moveSpeed
            )
    
            // Face movement direction
            const targetPos = catGroup1.position.clone().sub(inputVector)
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().lookAt(catGroup1.position, targetPos, new THREE.Vector3(0, 1, 0))
            )
            catGroup1.quaternion.slerp(targetQuat, 0.2)
            catBoxBody.quaternion.copy(catGroup1.quaternion)
        } else {
            catBoxBody.velocity.set(0, 0, 0)
        }
    
        // Sync visual position to physics body
        //catGroup1.position.copy(catBoxBody.position)
    }
    
    
    

    
    

// Agregar segundo gato 

if (catBoxBody2 && catGroup2) {
    const moveSpeed = 7
    const inputVector = new THREE.Vector3()

    if (keysPressed.KeyW) inputVector.z -= 1
    if (keysPressed.KeyS) inputVector.z += 1
    if (keysPressed.KeyA) inputVector.x -= 1
    if (keysPressed.KeyD) inputVector.x += 1

    if (inputVector.lengthSq() > 0) {
        inputVector.normalize()

        // 🟢 Apply velocity to Cannon body
        catBoxBody2.velocity.set(
            inputVector.x * moveSpeed,
            0,
            inputVector.z * moveSpeed
        )

        // 🎯 Rotate the visual cat based on movement direction
        const targetPos = catGroup2.position.clone().sub(inputVector)
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(catGroup2.position, targetPos, new THREE.Vector3(0, 1, 0))
        )
        catGroup2.quaternion.slerp(targetQuat, 0.2)
        catBoxBody2.quaternion.copy(catGroup2.quaternion)
    } else {
        catBoxBody2.velocity.set(0, 0, 0)
    }

}


//sincronizar posicion de cajas fisicas
// Sync cat group to follow physics body (no conflict)
if (catBoxBody && catGroup1) {
    const offset = new THREE.Vector3(0, 0.05, 0)
    
    // Sync position (visual follows physics)
    catGroup1.position.copy(catBoxBody.position).add(offset)

    // Sync rotation (important!)
    catGroup1.quaternion.copy(catBoxBody.quaternion)
}

if (catBoxBody2 && catGroup2) {
    const offset = new THREE.Vector3(0, 0.05, 0)
    
    // Sync position (visual follows physics)
    catGroup2.position.copy(catBoxBody2.position).add(offset)

    // Sync rotation (important!)
    catGroup2.quaternion.copy(catBoxBody2.quaternion)
}

  // sincronizar cajas visibles con fisicas -  DEBUG
//   if (catGroup1 && catVisualBox) {
//     const offset = new THREE.Vector3(0, 0.05, 0)
//     catVisualBox.position.copy(catGroup1.position.clone().add(offset))
//     catVisualBox.quaternion.copy(catGroup1.quaternion)
// }

// if (catGroup2 && catVisualBox2) {
//     const offset = new THREE.Vector3(0, 0.05, 0)
//     catVisualBox2.position.copy(catGroup2.position.clone().add(offset))
//     catVisualBox2.quaternion.copy(catGroup2.quaternion)
// }

for (let i = objectsToUpdate.length - 1; i >= 0; i--) {
    const { mesh, body, fakeShadow } = objectsToUpdate[i]
  
    // If object is too low (fell off world)
    if (body.position.y < 0.1) {
      // Remove from scene and physics world
      scene.remove(mesh)
      scene.remove(fakeShadow)
      world.removeBody(body)
  
      // Remove from update list
      objectsToUpdate.splice(i, 1)
    }
  }
  

// 3. Animaciones
const anyKeyPressed = Object.values(keysPressed).some(Boolean)
if (mixer) {
    mixer.update(deltaTime)
    allActions.forEach(action => action.paused = !(keysPressed.ArrowUp || keysPressed.ArrowDown || keysPressed.ArrowLeft || keysPressed.ArrowRight))
}
if (mixer2) {
    mixer2.update(deltaTime)
    allActions2.forEach(action => action.paused = !(keysPressed.KeyW || keysPressed.KeyA || keysPressed.KeyS || keysPressed.KeyD))
}

/// Sobras falsas para gatos


// logica indicador de colision con peces
if (catGroup1 && statusShadowCat1 && catBoxBody) {
    updateStatusShadow(catGroup1, statusShadowCat1, catBoxBody)
}


// logica indicador de colision con peces2
if (catGroup2 && statusShadowCat2 && catBoxBody2) {
    updateStatusShadow(catGroup2, statusShadowCat2, catBoxBody2)
}

// Update debug floor area helper position
// if (catBoxBody) {
//     cat1FloorAreaHelper.visible = true
//     cat1FloorAreaHelper.position.set(
//         catBoxBody.position.x,
//         0.02, // just above floor
//         catBoxBody.position.z +1.08// same offset as the Cannon box floor shape
//     )
// }

// if (catBoxBody2) {
//     cat2FloorAreaHelper.visible = true
//     cat2FloorAreaHelper.position.set(
//         catBoxBody2.position.x,
//         0.02,
//         catBoxBody2.position.z  +1.08 
//     )
//}




    // 4. Render y update
    controls.update()
    composer.render()
    //renderer.render(scene, camera) 
  

    // update scores
    document.getElementById('scoreCat1').textContent = scoreCat1
    document.getElementById('scoreCat2').textContent = scoreCat2

    const info = renderer.info

    console.log(`🧱 Geometries: ${info.memory.geometries}`)
    console.log(`🎨 Textures: ${info.memory.textures}`)
    console.log(`🔺 Triangles: ${info.render.triangles}`)
    

    requestAnimationFrame(tick)
}

function startRandomBoxSpawner() {
    function spawnBox() {
        createBox(0.2, 0.4, 0.1, {
            x: (Math.random() - 0.5) * 9,
            y: 15,
            z: (Math.random() - 0.5) * 9
        })

        // Schedule next spawn
        const nextDelay = Math.random() * 800 + 800 // 1000–3000 ms
        setTimeout(spawnBox, nextDelay)
    }

    spawnBox()
}

function startTimer() {
    const timerDisplay = document.getElementById('timer')
    timerDisplay.textContent = `⏱ ${timeRemaining}`
  
    timerInterval = setInterval(() => {
      timeRemaining--
      timerDisplay.textContent = `⏱ ${timeRemaining}`
  
      if (timeRemaining <= 0) {
        endGame()
      }
    }, 1000)
  }
  
function startGame() {
    startRandomBoxSpawner()
    tick()
    startTimer()
    if (backgroundSound.buffer && !backgroundSound.isPlaying) {
        backgroundSound.play()
    }
}

// End game
function endGame() {
    clearInterval(timerInterval)
    gameEnded = true
  
    // Stop cat movement
    catBoxBody.velocity.set(0, 0, 0)
    catBoxBody2.velocity.set(0, 0, 0)
  
    // Show final score
    document.getElementById('finalScore1').textContent = scoreCat1
    document.getElementById('finalScore2').textContent = scoreCat2
  
    // Show end screen
    document.getElementById('endScreen').style.display = 'flex'
  }
  
  
  window.addEventListener('wheel', (event) => {
    if (!backgroundSound || !backgroundSound.isPlaying) return

    const delta = event.deltaY * +0.001
    let currentVolume = backgroundSound.getVolume()
    let newVolume = THREE.MathUtils.clamp(currentVolume + delta, 0, 1)

    backgroundSound.setVolume(newVolume)

    const volumeDisplay = document.getElementById('volumeDisplay')
    volumeDisplay.textContent = `Volume: ${(newVolume * 100).toFixed(0)}%`

    console.log('🔊 Volume:', newVolume.toFixed(2))
})

  

document.getElementById('startButton').addEventListener('click', () => {
    document.getElementById('startScreen').style.display = 'none'
    startGame()
})

document.getElementById('restartButton').addEventListener('click', () => {
    location.reload() // simple way to restart everything
  })
  
